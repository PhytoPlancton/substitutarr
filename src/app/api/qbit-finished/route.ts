import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Download } from "@/models/Download";
import { importCompletedTorrent } from "@/lib/post-import";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Endpoint that qBit's autorun program hits the *instant* a torrent finishes.
 * The 60s in-app sweep is the fallback; this gives Radarr-level latency
 * (file shows up in Jellyfin within ~1s of the seeding flip).
 *
 * qBit calls us with all four % substitutions in the query string:
 *   GET /api/qbit-finished?hash=%I&category=%L&path=%F&name=%N
 *
 * Localhost-only — qBit is on the same machine as substitutarr, no need for
 * the HMAC dance. Calls from external hosts (with X-Forwarded-For) get 403.
 *
 * Fire-and-forget on the qBit side: we kick off the import async and return
 * 200 immediately so qBit's wait timeout never trips.
 */
function isLocal(req: Request): boolean {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return false; // someone proxied this in; not local
  return (
    host.startsWith("127.0.0.1") ||
    host.startsWith("localhost") ||
    host.startsWith("[::1]") ||
    host.startsWith("::1")
  );
}

async function handle(req: Request) {
  if (!isLocal(req)) {
    return NextResponse.json({ error: "localhost only" }, { status: 403 });
  }

  const url = new URL(req.url);
  const hash = (url.searchParams.get("hash") ?? "").toLowerCase();
  const category = url.searchParams.get("category") ?? "";
  const contentPath = url.searchParams.get("path") ?? "";
  const torrentName = url.searchParams.get("name") ?? "";

  if (!hash || !category || !contentPath) {
    return NextResponse.json(
      { error: "missing required params (hash, category, path)" },
      { status: 400 },
    );
  }

  if (!category.startsWith("substitutarr-")) {
    // qBit fires autorun for ALL torrents, not just ours. Skip silently.
    return NextResponse.json({ ok: true, ignored: "not a substitutarr category" });
  }

  // Find the Download row by infohash so we can resolve userId + mediaId
  await connectMongo();
  const dl = await Download.findOne({ qbHash: hash }).lean<any>();
  if (!dl) {
    log.warn("qbit-finished: no Download for hash", { hash });
    return NextResponse.json({ ok: true, ignored: "no matching download" });
  }

  // Fire-and-forget: respond to qBit immediately, run the import in the
  // background. qBit's autorun has a short timeout — we don't want it to
  // think the call failed.
  void (async () => {
    try {
      const r = await importCompletedTorrent({
        userId: dl.userId,
        downloadId: dl._id.toString(),
        contentPath,
        category,
        torrentName,
      });
      if (r.ok) {
        log.info("qbit-finished: import OK", { hash, linked: r.linkedFiles.length });
      } else {
        log.warn("qbit-finished: import failed", { hash, error: r.error });
      }
    } catch (e: any) {
      log.warn("qbit-finished: handler crashed", { hash, message: e.message });
    }
  })();

  return NextResponse.json({ ok: true, queued: true });
}

export async function GET(req: Request) {
  return handle(req);
}
export async function POST(req: Request) {
  return handle(req);
}
