/**
 * In-app scheduler that boots when substitutarr starts (PM2 / node server.js).
 *
 * Replaces the Windows Task Scheduler / cron / GitHub Actions external
 * scheduler dependency. The PM2-managed Node process keeps the timers
 * alive forever; restarts re-arm them on boot.
 *
 *   sweep (every 60s)  → poll qBit, import completed torrents, grab missing
 *   webhooks (60s)     → drain pending outbound deliveries
 *   retention (6h)     → enforce retention rules (notice scheduling only)
 *
 * The HTTP /api/cron* endpoints stay available for serverless deployments
 * (Vercel, etc.) where setInterval would die on cold start.
 */

import { sweep } from "@/lib/sweep";
import { flushPending } from "@/lib/webhooks";
import { evaluateCandidates, scheduleNotices } from "@/lib/retention";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";
import { log } from "@/lib/logger";

const SWEEP_INTERVAL_MS = 60_000; // Radarr-tier "instant" import
const WEBHOOK_INTERVAL_MS = 60_000;
const RETENTION_INTERVAL_MS = 6 * 60 * 60_000;

// Bail out if scheduler is already running (HMR / multiple worker re-init in dev)
const g = globalThis as any;
if (!g.__substitutarr_scheduler__) {
  g.__substitutarr_scheduler__ = true;

  async function runSweep() {
    const ok = await acquireCronLock("reconcile", 5 * 60_000);
    if (!ok) return;
    try {
      const r = await sweep();
      if (r.errors.length > 0) {
        log.warn("in-app sweep had errors", { errors: r.errors.slice(0, 5) });
      }
      if (r.reconciled || r.grabbed) {
        log.info(`in-app sweep: reconciled=${r.reconciled} grabbed=${r.grabbed}`);
      }
    } catch (e: any) {
      log.warn("in-app sweep failed", { message: e.message });
    } finally {
      await releaseCronLock("reconcile");
    }
  }

  async function runWebhooks() {
    try {
      await flushPending(undefined, 20);
    } catch (e: any) {
      log.warn("in-app webhook flush failed", { message: e.message });
    }
  }

  async function runRetention() {
    try {
      await connectMongo();
      const userIds: string[] = await UserSettings.distinct("userId", {
        "retention.mode": { $in: ["dry_run", "active"] },
      });
      if (userIds.length === 0) return;
      const lockOk = await acquireCronLock("retention", 30 * 60_000);
      if (!lockOk) return;
      try {
        for (const userId of userIds) {
          const s = (await UserSettings.findOne({ userId }).lean()) as any;
          const r = s?.retention;
          if (!r || r.mode === "off") continue;
          const evalRes = await evaluateCandidates(userId);
          if (evalRes.skippedReason) continue;
          if (r.mode === "active") {
            await scheduleNotices(userId, evalRes.candidates, r.preDeleteNoticeHours ?? 24);
          }
          await UserSettings.updateOne(
            { userId },
            {
              $set: {
                "retention.lastRunAt": new Date(),
                "retention.lastRunSummary.candidates": evalRes.candidates.length,
              },
            },
          );
        }
      } finally {
        await releaseCronLock("retention");
      }
    } catch (e: any) {
      log.warn("in-app retention sweep failed", { message: e.message });
    }
  }

  // Stagger the first runs so they don't all hit Mongo at the same instant
  setTimeout(runSweep, 5_000);
  setTimeout(runWebhooks, 10_000);
  setTimeout(runRetention, 30_000);

  setInterval(runSweep, SWEEP_INTERVAL_MS);
  setInterval(runWebhooks, WEBHOOK_INTERVAL_MS);
  setInterval(runRetention, RETENTION_INTERVAL_MS);

  log.info("in-app scheduler started: sweep 60s, webhooks 60s, retention 6h");
}
