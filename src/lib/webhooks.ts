import crypto from "node:crypto";
import { connectMongo } from "./mongo";
import { OutboundWebhook, WebhookDelivery } from "@/models/OutboundWebhook";
import { log } from "./logger";
import { sendDiscord } from "./discord";

export type WebhookEvent =
  | "request.grabbed"
  | "request.completed"
  | "request.failed";

const MAX_ATTEMPTS = 5;
/** Exponential backoff in seconds: 30s, 2m, 8m, 32m, 2h. */
const BACKOFF_SECONDS = [30, 120, 480, 1920, 7200];

function signPayload(secret: string, body: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

/**
 * Reshape a substitutarr event payload into the Sonarr/Radarr Connect schema
 * — minimum subset that Overseerr / Discord embeds expect.
 * Best-effort, lossy: we never round-trip back from this format.
 */
function toRadarrCompatBody(event: WebhookEvent, payload: any): any {
  const eventType =
    event === "request.grabbed"
      ? "Grab"
      : event === "request.completed"
        ? "Download"
        : "DownloadFailure";
  if (payload.type === "movie") {
    return {
      eventType,
      movie: {
        id: payload.mediaId,
        title: payload.title,
        year: payload.year,
        tmdbId: payload.tmdbId,
      },
      release: payload.release,
      downloadInfo: payload.download,
    };
  }
  // tv → Sonarr-shaped
  return {
    eventType,
    series: {
      id: payload.mediaId,
      title: payload.title,
      year: payload.year,
      tvdbId: payload.tvdbId,
      tmdbId: payload.tmdbId,
    },
    episodes: payload.episodes,
    release: payload.release,
    downloadInfo: payload.download,
  };
}

/**
 * Emit an event to all subscribed webhooks for this user.
 * Creates pending Delivery rows then kicks off an immediate flush attempt.
 *
 * Always fire-and-forget from the caller's perspective: deliveries failing
 * here must not break grabbing/post-processing.
 */
export async function emit(
  userId: string,
  event: WebhookEvent,
  payload: Record<string, any>,
): Promise<void> {
  try {
    await connectMongo();
    const targets = await OutboundWebhook.find({ userId, active: true, events: event }).lean<any[]>();
    if (targets.length === 0) {
      // Still fan out to Discord if user has it set on UserSettings — that lives in lib/discord.ts.
      void sendDiscord(userId, event, payload).catch(() => {});
      return;
    }

    const now = new Date();
    await WebhookDelivery.insertMany(
      targets.map((w) => ({
        userId,
        webhookId: w._id,
        event,
        payload,
        nextAttemptAt: now,
      })),
    );
    // Fire and forget — drains within this request if cold-start allows.
    void flushPending(userId).catch((e) =>
      log.warn("webhook flush failed", { userId, message: e.message }),
    );
    void sendDiscord(userId, event, payload).catch(() => {});
  } catch (e: any) {
    log.warn("webhook emit failed", { userId, event, message: e.message });
  }
}

/** POST one delivery, update its row. Public for cron. */
export async function attemptDelivery(deliveryId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  await connectMongo();
  const d = await WebhookDelivery.findById(deliveryId);
  if (!d || d.deliveredAt || d.deadLetterAt) return { ok: false, error: "stale" };
  const w = await OutboundWebhook.findById(d.webhookId).lean<any>();
  if (!w || !w.active) {
    d.deadLetterAt = new Date();
    d.lastError = "webhook inactive or deleted";
    await d.save();
    return { ok: false, error: d.lastError };
  }

  const body = JSON.stringify(w.radarrCompat ? toRadarrCompatBody(d.event as WebhookEvent, d.payload) : {
    event: d.event,
    deliveryId: d._id.toString(),
    timestamp: new Date().toISOString(),
    payload: d.payload,
  });
  const signature = signPayload(w.secret, body);

  d.attempts = (d.attempts ?? 0) + 1;
  let ok = false;
  let status: number | undefined;
  let errMsg: string | undefined;
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(w.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "substitutarr/1.0",
        "x-substitutarr-event": d.event,
        "x-substitutarr-signature": signature,
        "x-substitutarr-delivery": d._id.toString(),
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    status = res.status;
    ok = res.status >= 200 && res.status < 300;
    if (!ok) errMsg = `HTTP ${res.status}`;
  } catch (e: any) {
    errMsg = e?.message ?? String(e);
  }

  d.lastStatus = status;
  d.lastError = errMsg;
  if (ok) {
    d.deliveredAt = new Date();
    await OutboundWebhook.updateOne(
      { _id: w._id },
      { $set: { lastDeliveryAt: new Date(), lastDeliveryStatus: "ok", failureCount: 0 } },
    );
  } else {
    if (d.attempts >= MAX_ATTEMPTS) {
      d.deadLetterAt = new Date();
    } else {
      const delay = BACKOFF_SECONDS[Math.min(d.attempts - 1, BACKOFF_SECONDS.length - 1)];
      d.nextAttemptAt = new Date(Date.now() + delay * 1000);
    }
    await OutboundWebhook.updateOne(
      { _id: w._id },
      {
        $set: { lastDeliveryAt: new Date(), lastDeliveryStatus: "fail" },
        $inc: { failureCount: 1 },
      },
    );
  }
  await d.save();
  return { ok, status, error: errMsg };
}

/** Drain due deliveries for a user (called inline + by cron). */
export async function flushPending(userId?: string, limit = 20): Promise<{ delivered: number; failed: number }> {
  await connectMongo();
  const filter: any = {
    deliveredAt: null,
    deadLetterAt: null,
    nextAttemptAt: { $lte: new Date() },
  };
  if (userId) filter.userId = userId;
  const due = await WebhookDelivery.find(filter)
    .sort({ nextAttemptAt: 1 })
    .limit(limit)
    .lean<any[]>();

  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    const r = await attemptDelivery(d._id.toString());
    if (r.ok) delivered++;
    else failed++;
  }
  return { delivered, failed };
}

/** Manual test ping — used by Settings → Webhooks → "Test connection" button. */
export async function testWebhook(webhookId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  await connectMongo();
  const w = await OutboundWebhook.findById(webhookId).lean<any>();
  if (!w) return { ok: false, error: "not found" };

  const body = JSON.stringify({
    event: "test.ping",
    deliveryId: "test",
    timestamp: new Date().toISOString(),
    payload: { message: "substitutarr webhook test" },
  });
  const signature = signPayload(w.secret, body);
  try {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(w.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "substitutarr/1.0",
        "x-substitutarr-event": "test.ping",
        "x-substitutarr-signature": signature,
      },
      body,
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
