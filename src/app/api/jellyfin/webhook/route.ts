import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Receiver for Jellyfin's "Webhook" plugin. Configure in Jellyfin :
 *   Server URL: https://substitutarr.nmt.ovh/api/jellyfin/webhook
 *   Header X-JF-Secret: <JELLYFIN_WEBHOOK_SECRET env value>
 * Useful events: ItemAdded, PlaybackStart, etc. We ack and log; richer
 * processing (e.g. update substitutarr download state when import lands) wires up
 * later.
 */
export async function POST(req: Request) {
  const secret = process.env.JELLYFIN_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "webhook not configured" }, { status: 503 });

  const provided = req.headers.get("x-jf-secret") ?? "";
  // Constant-time comparison
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: any = {};
  try { body = await req.json(); } catch { /* webhook may be plain text */ }

  log.info("jellyfin webhook", {
    type: body?.NotificationType ?? body?.event ?? "unknown",
    item: body?.Name ?? body?.item?.name,
  });

  return NextResponse.json({ ok: true });
}
