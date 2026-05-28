import { connectMongo } from "./mongo";
import { Media } from "@/models/Media";
import { Download } from "@/models/Download";
import { grabBest } from "./grab";
import { getUserQbit } from "./qbittorrent";
import { recordHealth } from "./connection-health";
import { importCompletedTorrent } from "./post-import";

/**
 * The main download-reconciliation sweep.
 *
 *  1. For every active Download, poll qBit. If completed and the category is
 *     substitutarr-*, run the TypeScript import (hardlink + foldering).
 *  2. For monitored Media still in `wanted` / `missing`, try to grab best.
 *
 * Pulled out of the HTTP route so the in-app cron (instrumentation.ts) can
 * call it directly without going through the HTTP layer.
 */
export async function sweep(): Promise<{
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
        void recordHealth({ userId, service: "qbit", ok: true, detail: "reconcile ok" });
        const byHash = new Map(torrents.map((t) => [t.hash.toLowerCase(), t]));

        for (const d of active) {
          const t = d.qbHash ? byHash.get(d.qbHash.toLowerCase()) : undefined;
          if (!t) {
            if (d.qbHash) {
              await Download.updateOne({ _id: d._id }, { $set: { state: "removed" } });
            }
            continue;
          }
          if (t.progress >= 1 || /^(uploading|stalledUP|forcedUP|pausedUP)$/.test(t.state)) {
            const category = (t as any).category as string | undefined;
            if (category?.startsWith("substitutarr-") && t.content_path) {
              try {
                const r = await importCompletedTorrent({
                  userId,
                  downloadId: d._id.toString(),
                  contentPath: t.content_path,
                  category,
                  torrentName: t.name,
                });
                if (r.ok) {
                  reconciled++;
                } else {
                  errors.push(`import ${t.name}: ${r.error}`);
                  await Download.updateOne(
                    { _id: d._id },
                    { $set: { state: "completed", progress: 1, importedPath: t.content_path } },
                  );
                }
              } catch (e: any) {
                errors.push(`import ${t.name}: ${e.message}`);
              }
            } else {
              await Download.updateOne(
                { _id: d._id },
                { $set: { state: "completed", progress: 1, importedPath: t.content_path } },
              );
              await Media.updateOne({ _id: d.mediaId, userId }, { $set: { status: "downloaded" } });
              reconciled++;
            }
          } else {
            await Download.updateOne(
              { _id: d._id },
              { $set: { progress: t.progress, state: "downloading", seeders: undefined } },
            );
          }
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
    })
      .limit(20)
      .lean<any[]>();

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
