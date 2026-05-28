import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";
import { Media } from "@/models/Media";
import { evaluateCandidates, performDeletion, scheduleNotices } from "@/lib/retention";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { emit as emitWebhook } from "@/lib/webhooks";
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
 * Daily retention sweep — one run per user.
 *
 *   mode=off     → nothing happens
 *   mode=dry_run → evaluate + record summary + send "would have deleted" Discord ping
 *   mode=active  → schedule notice (preDeleteNoticeHours in the future) for new
 *                  candidates, then actually delete items whose pendingAt is past.
 *                  Hard cap = maxDeletionsPerDay.
 */
async function sweepUser(userId: string): Promise<{
  mode: string;
  candidates: number;
  deleted: number;
  bytesFreed: number;
  scheduled: number;
  skippedReason?: string;
}> {
  await connectMongo();
  const s = (await UserSettings.findOne({ userId }).lean()) as any;
  const r = s?.retention;
  if (!r || r.mode === "off") {
    return { mode: "off", candidates: 0, deleted: 0, bytesFreed: 0, scheduled: 0 };
  }

  const evalResult = await evaluateCandidates(userId);
  if (evalResult.skippedReason) {
    await UserSettings.updateOne(
      { userId },
      {
        $set: {
          "retention.lastRunAt": new Date(),
          "retention.lastRunSummary": {
            candidates: 0,
            deleted: 0,
            bytesFreed: 0,
            skippedReason: evalResult.skippedReason,
          },
        },
      },
    );
    return { mode: r.mode, candidates: 0, deleted: 0, bytesFreed: 0, scheduled: 0, skippedReason: evalResult.skippedReason };
  }

  let deleted = 0;
  let bytesFreed = 0;
  let scheduled = 0;

  if (r.mode === "dry_run") {
    void emitWebhook(userId, "request.failed" as any, {
      // Re-use request.failed channel — payload is shaped distinctly via `kind`
      kind: "retention_dry_run",
      candidateCount: evalResult.candidates.length,
      totalBytes: evalResult.totalBytes,
      candidates: evalResult.candidates.slice(0, 20).map((c) => ({
        title: c.title,
        year: c.year,
        reason: c.reason,
        detail: c.detail,
        sizeBytes: c.sizeBytes,
      })),
    }).catch(() => {});
  } else if (r.mode === "active") {
    // 1) Find candidates whose notice has matured → delete (capped)
    const now = new Date();
    const ready = await Media.find({
      userId,
      retentionPendingAt: { $lte: now, $ne: null } as any,
      retentionDeletedAt: null,
      retentionExcluded: { $ne: true },
    }).lean<any[]>();

    const cap = r.maxDeletionsPerDay ?? 10;
    for (const m of ready) {
      if (deleted >= cap) break;
      // Re-derive paths from the current Media doc (might have changed since notice scheduled)
      const paths: string[] = [];
      let size = 0;
      if (m.type === "tv") {
        for (const s of m.seasons ?? []) {
          for (const e of s.episodes ?? []) {
            if (e.file?.path) {
              paths.push(e.file.path);
              size += e.file.sizeBytes ?? 0;
            }
          }
        }
      }
      const res = await performDeletion(userId, {
        mediaId: m._id.toString(),
        tmdbId: m.tmdbId,
        type: m.type,
        title: m.title,
        year: m.year,
        reason: "notWatchedSinceImport", // best-effort; the original reason is in retentionPendingReason
        detail: m.retentionPendingReason ?? "scheduled",
        sizeBytes: size,
        filePaths: paths,
        addedAt: m.addedAt,
      });
      if (res.ok) {
        deleted++;
        bytesFreed += res.bytesFreed;
      }
    }

    // 2) Schedule notices for any newly-matching candidates that don't have one yet
    const newScheduled = await scheduleNotices(userId, evalResult.candidates, r.preDeleteNoticeHours ?? 24);
    scheduled = newScheduled.length;
    if (scheduled > 0) {
      // Discord ping with the upcoming deletions so the user can override
      const upcomingDate = new Date(Date.now() + (r.preDeleteNoticeHours ?? 24) * 3600_000);
      void emitWebhook(userId, "request.failed" as any, {
        kind: "retention_notice",
        scheduledAt: upcomingDate.toISOString(),
        candidates: newScheduled.slice(0, 20).map((c) => ({
          mediaId: c.mediaId,
          title: c.title,
          year: c.year,
          reason: c.reason,
          detail: c.detail,
          sizeBytes: c.sizeBytes,
        })),
      }).catch(() => {});
    }
  }

  await UserSettings.updateOne(
    { userId },
    {
      $set: {
        "retention.lastRunAt": new Date(),
        "retention.lastRunSummary": {
          candidates: evalResult.candidates.length,
          deleted,
          bytesFreed,
        },
      },
    },
  );

  return { mode: r.mode, candidates: evalResult.candidates.length, deleted, bytesFreed, scheduled };
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const acquired = await acquireCronLock("retention", 30 * 60_000);
  if (!acquired) {
    log.warn("retention cron skipped — lock held");
    return NextResponse.json({ ok: true, skipped: "lock held" });
  }
  try {
    await connectMongo();
    const userIds: string[] = await UserSettings.distinct("userId", {
      "retention.mode": { $in: ["dry_run", "active"] },
    });
    const results = [];
    for (const userId of userIds) {
      try {
        results.push({ userId, ...(await sweepUser(userId)) });
      } catch (e: any) {
        results.push({ userId, error: e.message });
      }
    }
    return NextResponse.json({ ok: true, users: results });
  } finally {
    await releaseCronLock("retention");
  }
}

export async function POST(req: Request) {
  return GET(req);
}
