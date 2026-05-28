import fs from "node:fs";
import path from "node:path";
import { connectMongo } from "./mongo";
import { Media } from "@/models/Media";
import { UserSettings } from "@/models/UserSettings";
import { Activity } from "@/models/Activity";
import { getUserJellyfin } from "./jellyfin";
import { log } from "./logger";

/**
 * Retention engine — finds candidates and (in active mode) deletes them.
 *
 * Design constraints:
 *  - Never act if Jellyfin is unreachable (no PlayCount data = no decision)
 *  - Never delete favorites (Jellyfin `IsFavorite`)
 *  - Never delete items added < 14 days ago (system-clock sanity)
 *  - Hard cap on deletions per run (default 10 — set in UserSettings.retention)
 *  - Soft delete: removes hardlinks + flips status to "missing" + monitored=false,
 *    keeps the Media doc + Activity log + qBit torrent (still seeds)
 */

export type Criterion =
  | "notWatchedSinceImport"
  | "watchedLongAgo"
  | "tvEndedBinged"
  | "diskPressure";

export type Candidate = {
  mediaId: string;
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  year?: number;
  reason: Criterion;
  detail: string;
  sizeBytes: number;
  filePaths: string[];
  lastPlayedDate?: string;
  addedAt: string;
};

const DAY_MS = 86400_000;
const RECENT_ADD_GUARD_DAYS = 14;

function daysSince(dateLike: Date | string | null | undefined): number | null {
  if (!dateLike) return null;
  const d = new Date(dateLike).getTime();
  if (!d) return null;
  return (Date.now() - d) / DAY_MS;
}

function aggregateMediaSize(media: any): { size: number; paths: string[] } {
  if (media.type === "movie") {
    // We don't persist movie file paths today (post-process only writes for TV).
    // Best-effort: 0 bytes, no path. The cron still flips status — the file
    // is wherever the post-DL hook hardlinked it.
    return { size: 0, paths: [] };
  }
  // TV: sum across all downloaded episodes
  let size = 0;
  const paths: string[] = [];
  for (const s of media.seasons ?? []) {
    for (const e of s.episodes ?? []) {
      if (e.file?.path) {
        paths.push(e.file.path);
        size += e.file.sizeBytes ?? 0;
      }
    }
  }
  return { size, paths };
}

function lastEpisodeAirDate(media: any): string | null {
  let max: string | null = null;
  for (const s of media.seasons ?? []) {
    for (const e of s.episodes ?? []) {
      if (e.airDate && (!max || e.airDate > max)) max = e.airDate;
    }
  }
  return max;
}

/**
 * Compute disk usage % for the volume that hosts the user's library paths.
 * Returns null when the path isn't accessible — callers treat that as "unknown,
 * skip diskPressure criterion".
 */
function diskUsagePercent(samplePath: string): number | null {
  try {
    const stat = fs.statfsSync(samplePath);
    const total = Number(stat.blocks) * Number(stat.bsize);
    const free = Number(stat.bavail) * Number(stat.bsize);
    if (!total) return null;
    return ((total - free) / total) * 100;
  } catch {
    return null;
  }
}

export type EvaluateResult = {
  candidates: Candidate[];
  totalBytes: number;
  jellyfinHealthy: boolean;
  diskPercent: number | null;
  diskPressureActive: boolean;
  skippedReason?: string;
};

/**
 * Read all of the user's media + Jellyfin UserData, apply the 4 criteria,
 * return everything that would be deleted (excluding the favorites + 14-day guard).
 *
 * Returns candidates sorted by oldest LastPlayedDate first (LRU) so the cron
 * can apply maxDeletionsPerDay deterministically.
 */
export async function evaluateCandidates(userId: string): Promise<EvaluateResult> {
  await connectMongo();
  const settings = (await UserSettings.findOne({ userId }).lean()) as any;
  const r = settings?.retention;
  if (!r) {
    return { candidates: [], totalBytes: 0, jellyfinHealthy: false, diskPercent: null, diskPressureActive: false, skippedReason: "no retention config" };
  }

  // Jellyfin must be reachable — without watch data we can't decide.
  const jf = await getUserJellyfin(userId);
  if (!jf) {
    return { candidates: [], totalBytes: 0, jellyfinHealthy: false, diskPercent: null, diskPressureActive: false, skippedReason: "Jellyfin not configured" };
  }
  let jfUserId: string | null;
  let userData: Awaited<ReturnType<typeof jf.getUserDataByTmdbId>>;
  try {
    jfUserId = await jf.getDefaultUserId();
    if (!jfUserId) {
      return { candidates: [], totalBytes: 0, jellyfinHealthy: false, diskPercent: null, diskPressureActive: false, skippedReason: "no Jellyfin user found" };
    }
    userData = await jf.getUserDataByTmdbId(jfUserId);
  } catch (e: any) {
    return { candidates: [], totalBytes: 0, jellyfinHealthy: false, diskPercent: null, diskPressureActive: false, skippedReason: `Jellyfin unreachable: ${e.message}` };
  }

  // Disk pressure check on the library volume (movies path is enough — same volume by setup wizard guarantee)
  const moviesRoot = settings.libraryPaths?.movies?.trim();
  const tvRoot = settings.libraryPaths?.tv?.trim();
  const diskPercent = moviesRoot ? diskUsagePercent(moviesRoot) : tvRoot ? diskUsagePercent(tvRoot) : null;
  const diskPressureActive = diskPercent !== null && diskPercent >= r.thresholds.diskPressurePercent;

  const allMedia = await Media.find({
    userId,
    retentionExcluded: { $ne: true },
    retentionDeletedAt: null,
  }).lean<any[]>();

  const now = Date.now();
  const candidates: Candidate[] = [];

  for (const m of allMedia) {
    // Per-item temporary exclusion (user clicked "Keep this 6 months" in Discord)
    if (m.retentionExcludedUntil && new Date(m.retentionExcludedUntil).getTime() > now) continue;
    // Recently-added guard
    const ageDays = daysSince(m.addedAt) ?? 0;
    if (ageDays < RECENT_ADD_GUARD_DAYS) continue;

    const ud = userData.get(m.tmdbId);
    if (ud?.isFavorite) continue; // veto

    const { size, paths } = aggregateMediaSize(m);
    if (m.type === "tv" && paths.length === 0) continue; // nothing on disk to free

    let matched: { reason: Criterion; detail: string } | null = null;

    // Criterion: notWatchedSinceImport
    if (ud && ud.playCount === 0 && ageDays >= r.thresholds.notWatchedSinceImportDays) {
      matched = {
        reason: "notWatchedSinceImport",
        detail: `never played since import (${Math.floor(ageDays)}d ago)`,
      };
    }

    // Criterion: watchedLongAgo
    if (!matched && ud && ud.playCount >= 1 && ud.lastPlayedDate) {
      const sinceWatched = daysSince(ud.lastPlayedDate) ?? 0;
      if (sinceWatched >= r.thresholds.watchedLongAgoDays) {
        matched = {
          reason: "watchedLongAgo",
          detail: `last watched ${Math.floor(sinceWatched)}d ago`,
        };
      }
    }

    // Criterion: tvEndedBinged
    if (
      !matched &&
      m.type === "tv" &&
      (m.tmdbStatus === "ended" || m.tmdbStatus === "canceled") &&
      ud?.lastPlayedDate
    ) {
      const sinceWatched = daysSince(ud.lastPlayedDate) ?? 0;
      // Require all downloaded episodes to be played
      const totalEps = (m.seasons ?? []).flatMap((s: any) => s.episodes ?? []).length;
      const playedAll = ud.played || ud.playCount >= totalEps;
      if (playedAll && sinceWatched >= r.thresholds.tvEndedBingedDays) {
        matched = {
          reason: "tvEndedBinged",
          detail: `ended TV, fully binged ${Math.floor(sinceWatched)}d ago`,
        };
      }
    }

    if (matched) {
      candidates.push({
        mediaId: m._id.toString(),
        tmdbId: m.tmdbId,
        type: m.type,
        title: m.title,
        year: m.year,
        reason: matched.reason,
        detail: matched.detail,
        sizeBytes: size,
        filePaths: paths,
        lastPlayedDate: ud?.lastPlayedDate,
        addedAt: m.addedAt,
      });
    }
  }

  // LRU sort: oldest lastPlayedDate first (falls back to oldest addedAt)
  candidates.sort((a, b) => {
    const aT = a.lastPlayedDate ? new Date(a.lastPlayedDate).getTime() : new Date(a.addedAt).getTime();
    const bT = b.lastPlayedDate ? new Date(b.lastPlayedDate).getTime() : new Date(b.addedAt).getTime();
    return aT - bT;
  });

  // If diskPressure is active and no item matched the time-based criteria,
  // do an LRU sweep across everything not-favorite + past the 14-day guard.
  if (diskPressureActive && candidates.length === 0) {
    for (const m of allMedia) {
      const ageDays = daysSince(m.addedAt) ?? 0;
      if (ageDays < RECENT_ADD_GUARD_DAYS) continue;
      const ud = userData.get(m.tmdbId);
      if (ud?.isFavorite) continue;
      const { size, paths } = aggregateMediaSize(m);
      if (m.type === "tv" && paths.length === 0) continue;
      candidates.push({
        mediaId: m._id.toString(),
        tmdbId: m.tmdbId,
        type: m.type,
        title: m.title,
        year: m.year,
        reason: "diskPressure",
        detail: `disk at ${diskPercent?.toFixed(1)}% — LRU sweep`,
        sizeBytes: size,
        filePaths: paths,
        lastPlayedDate: ud?.lastPlayedDate,
        addedAt: m.addedAt,
      });
    }
    candidates.sort((a, b) => {
      const aT = a.lastPlayedDate ? new Date(a.lastPlayedDate).getTime() : new Date(a.addedAt).getTime();
      const bT = b.lastPlayedDate ? new Date(b.lastPlayedDate).getTime() : new Date(b.addedAt).getTime();
      return aT - bT;
    });
  }

  const totalBytes = candidates.reduce((acc, c) => acc + c.sizeBytes, 0);
  return { candidates, totalBytes, jellyfinHealthy: true, diskPercent, diskPressureActive };
}

/**
 * Actually delete a candidate — removes hardlinks, flips DB status.
 * NEVER touches the qBit torrent / source files in the downloads folder.
 */
export async function performDeletion(userId: string, c: Candidate): Promise<{ ok: boolean; bytesFreed: number; error?: string }> {
  await connectMongo();
  let bytesFreed = 0;
  const errors: string[] = [];

  for (const p of c.filePaths) {
    try {
      const stat = fs.statSync(p);
      bytesFreed += stat.size;
      fs.unlinkSync(p);
      // Clean up empty parent folder (Season NN) if applicable
      const dir = path.dirname(p);
      try {
        const remaining = fs.readdirSync(dir);
        if (remaining.length === 0) fs.rmdirSync(dir);
      } catch {
        /* not critical */
      }
    } catch (e: any) {
      if (e.code === "ENOENT") {
        // File already gone — keep going, this is fine for our purposes
      } else {
        errors.push(`${p}: ${e.message}`);
      }
    }
  }

  // Flip DB status
  if (c.type === "movie") {
    await Media.updateOne(
      { _id: c.mediaId, userId },
      {
        $set: {
          status: "missing",
          monitored: false,
          retentionDeletedAt: new Date(),
          retentionPendingAt: null,
        },
      },
    );
  } else {
    // TV: clear file on each episode
    const m = await Media.findOne({ _id: c.mediaId, userId });
    if (m) {
      for (const s of m.seasons ?? []) {
        for (const ep of s.episodes ?? []) {
          if (ep.file?.path && c.filePaths.includes(ep.file.path)) {
            ep.file = undefined;
            ep.status = "missing";
          }
        }
      }
      m.monitored = false;
      m.retentionDeletedAt = new Date();
      m.retentionPendingAt = null;
      await m.save();
    }
  }

  void Activity.create({
    userId,
    mediaId: c.mediaId,
    kind: "retention_deleted",
    title: c.title,
    detail: `${c.reason}: ${c.detail} — freed ${(bytesFreed / 1e9).toFixed(2)} GB`,
  }).catch(() => {});

  if (errors.length > 0) {
    log.warn("retention: partial deletion", { mediaId: c.mediaId, errors });
    return { ok: false, bytesFreed, error: errors.join("; ") };
  }
  return { ok: true, bytesFreed };
}

/**
 * Schedule pre-deletion notices: marks candidates with `retentionPendingAt` =
 * now + preDeleteNoticeHours and emits the request.retention_pending webhook.
 * Returns the items that were just scheduled (so the cron can ping Discord).
 */
export async function scheduleNotices(userId: string, candidates: Candidate[], noticeHours: number): Promise<Candidate[]> {
  await connectMongo();
  const scheduled: Candidate[] = [];
  const eta = new Date(Date.now() + noticeHours * 3600_000);
  for (const c of candidates) {
    const m = await Media.findOne({ _id: c.mediaId, userId }, { retentionPendingAt: 1 }).lean<any>();
    if (m?.retentionPendingAt) continue; // already notified
    await Media.updateOne(
      { _id: c.mediaId, userId },
      { $set: { retentionPendingAt: eta, retentionPendingReason: `${c.reason}: ${c.detail}` } },
    );
    scheduled.push(c);
  }
  return scheduled;
}

/** Restore a previously retention-deleted item — flips monitored back on so
 *  the next cron sweep re-grabs the same content. */
export async function restoreFromRetention(userId: string, mediaId: string): Promise<{ ok: boolean }> {
  await connectMongo();
  const m = await Media.findOne({ _id: mediaId, userId });
  if (!m) return { ok: false };
  m.monitored = true;
  if (m.type === "movie") m.status = "wanted";
  m.retentionDeletedAt = null;
  m.retentionPendingAt = null;
  m.retentionExcludedUntil = null;
  await m.save();
  void Activity.create({
    userId,
    mediaId,
    kind: "retention_restored",
    title: m.title,
  }).catch(() => {});
  return { ok: true };
}
