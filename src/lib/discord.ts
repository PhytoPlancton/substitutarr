import { connectMongo } from "./mongo";
import { UserSettings } from "@/models/UserSettings";
import { log } from "./logger";

/**
 * Discord webhooks accept a simple JSON body. We render an embed-style message
 * per event so the user sees title, poster, status — instead of raw JSON.
 *
 * Fire-and-forget: never throws to the caller. Discord rate-limits at 30 req/min;
 * we use a single fetch with no retries so we don't hammer the endpoint.
 */
export async function sendDiscord(
  userId: string,
  event: string,
  payload: any,
): Promise<void> {
  try {
    await connectMongo();
    const s = await UserSettings.findOne({ userId }, { notifications: 1 }).lean<any>();
    const url: string | undefined = s?.notifications?.discordWebhook?.trim();
    if (!url) return;
    const events: string[] = s?.notifications?.discordEvents ?? ["request.completed", "request.failed"];
    if (!events.includes(event)) return;

    const color =
      event === "request.completed" ? 0x4ade80 : event === "request.failed" ? 0xf43f5e : 0x7c5cff;
    const titleEmoji =
      event === "request.completed" ? "✅" : event === "request.failed" ? "❌" : "📥";
    const title = `${titleEmoji} ${payload.title ?? "Unknown"}${payload.year ? ` (${payload.year})` : ""}`;
    const fields: { name: string; value: string; inline?: boolean }[] = [];
    if (payload.release?.title) fields.push({ name: "Release", value: payload.release.title.slice(0, 1024) });
    if (payload.release?.indexer) fields.push({ name: "Indexer", value: payload.release.indexer, inline: true });
    if (payload.release?.quality) fields.push({ name: "Quality", value: payload.release.quality, inline: true });
    if (payload.episodes?.length) {
      const eps = payload.episodes
        .map((e: any) => `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`)
        .slice(0, 10)
        .join(", ");
      fields.push({ name: "Episodes", value: eps });
    }
    if (payload.error) fields.push({ name: "Error", value: payload.error.slice(0, 1024) });

    const body = {
      embeds: [
        {
          title,
          description: payload.subtitle ?? undefined,
          color,
          fields,
          thumbnail: payload.poster ? { url: payload.poster } : undefined,
          footer: { text: `substitutarr · ${event}` },
          timestamp: new Date().toISOString(),
        },
      ],
    };

    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) log.warn("discord webhook non-2xx", { status: res.status, event });
  } catch (e: any) {
    log.warn("discord webhook failed", { message: e?.message ?? String(e) });
  }
}
