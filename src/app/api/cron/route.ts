import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { Download } from "@/models/Download";
import { grabBest } from "@/lib/grab";
import { getUserQbit } from "@/lib/qbittorrent";
import { getUserJellyfin } from "@/lib/jellyfin";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { recordHealth } from "@/lib/connection-health";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-secret");
  return got === expected;
}

/**
 * Single sweep:
 *   1. Reconcile in-flight downloads with qBittorrent — mark completed, fire Jellyfin refresh.
 *   2. For each monitored "wanted" or "missing" media, try to grab best release.
 */
async function sweep(): Promise<{
  reconciled: number;
  grabbed: number;
  errors: string[];
}> {
  await connectMongo();
  const errors: string[] = [];
  let reconciled = 0;
  let grabbed = 0;

  const userIds: string[] = await Media.distinct("userId");

  for (const userId of userIds) {
    // 1. Reconcile downloads
    const active = await Download.find({
      userId,
      state: { $in: ["queued", "downloading"] },
    }).lean<any[]>();

    if (active.length) {
      try {
        const qbit = await getUserQbit(userId);
        const hashes = active.map((d) => d.qbHash).filter(Boolean) as string[];
        const torrents = hashes.length ? await qbit.list({ hashes }) : [];
        // qBit responded → record health (covers users who never click Test).
        void recordHealth({ userId, service: "qbit", ok: true, detail: "reconcile ok" });
        const byHash = new Map(torrents.map((t) => [t.hash.toLowerCase(), t]));

        let didComplete = false;
        for (const d of active) {
          const t = d.qbHash ? byHash.get(d.qbHash.toLowerCase()) : undefined;
          if (!t) {
            // Torrent was deleted in qBit UI without going through substitutarr.
            // Mark removed so the user sees the discrepancy.
            if (d.qbHash) {
              await Download.updateOne({ _id: d._id }, { $set: { state: "removed" } });
            }
            continue;
          }
          if (t.progress >= 1 || /^(uploading|stalledUP|forcedUP|pausedUP)$/.test(t.state)) {
            await Download.updateOne(
              { _id: d._id },
              { $set: { state: "completed", progress: 1, importedPath: t.content_path } },
            );
            await Media.updateOne({ _id: d.mediaId, userId }, { $set: { status: "downloaded" } });
            reconciled++;
            didComplete = true;
          } else {
            await Download.updateOne(
              { _id: d._id },
              { $set: { progress: t.progress, state: "downloading", seeders: undefined } },
            );
          }
        }

        if (didComplete) {
          const jf = await getUserJellyfin(userId);
          if (jf) await jf.refreshAll().catch((e) => errors.push(`jellyfin: ${e.message}`));
        }
      } catch (e: any) {
        void recordHealth({ userId, service: "qbit", ok: false, detail: e.message });
        errors.push(`qbit reconcile (${userId}): ${e.message}`);
      }
    }

    // 2. Grab missing
    const wanted = await Media.find({
      userId,
      monitored: true,
      status: { $in: ["wanted", "missing"] },
    }).limit(20).lean<any[]>();

    for (const m of wanted) {
      try {
        const r = await grabBest({ userId, mediaId: m._id.toString() });
        if (r.ok) grabbed++;
      } catch (e: any) {
        errors.push(`grab ${m.title}: ${e.message}`);
      }
    }
  }

  return { reconciled, grabbed, errors };
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const acquired = await acquireCronLock("reconcile", 15 * 60_000);
  if (!acquired) {
    log.warn("cron reconcile skipped — another run holds the lock");
    return NextResponse.json({ ok: true, skipped: "lock held" });
  }
  try {
    const result = await sweep();
    return NextResponse.json({ ok: true, ...result });
  } finally {
    await releaseCronLock("reconcile");
  }
}

export async function POST(req: Request) {
  return GET(req);
}
