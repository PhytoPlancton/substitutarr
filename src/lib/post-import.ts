import fs from "node:fs";
import path from "node:path";
import { connectMongo } from "./mongo";
import { Media } from "@/models/Media";
import { Download } from "@/models/Download";
import { Activity } from "@/models/Activity";
import { UserSettings } from "@/models/UserSettings";
import { getUserJellyfin } from "./jellyfin";
import { emit as emitWebhook } from "./webhooks";
import { log } from "./logger";

/**
 * Radarr-style post-import: substitutarr (this Node process) does the
 * hardlink + foldering itself, instead of relying on a PowerShell hook
 * triggered by qBit.
 *
 * Trade-off vs the PowerShell hook:
 *   + Zero qBit configuration (no "Run external program" to set up)
 *   + Cross-platform (Linux/macOS users can self-host too)
 *   + No HMAC / signing layer to debug
 *   - Import happens up to N minutes after qBit completes (cron cadence)
 *
 * Called from /api/cron/route.ts when a Download row flips to completed.
 */

const VIDEO_EXT = new Set([".mkv", ".mp4", ".avi", ".ts", ".mov", ".m4v", ".wmv"]);
const SUB_EXT = new Set([".srt", ".ass", ".ssa", ".vtt", ".sub", ".idx"]);
const SKIP_PATTERNS = [
  /sample/i,
  /proof/i,
  /screens?/i,
  /rarbg\.txt$/i,
  /\.nfo$/i,
  /\.txt$/i,
  /\.jpg$/i,
  /\.png$/i,
  /\.sfv$/i,
  /\.md5$/i,
];

const TV_STD_RE = /^(?<show>.+?)[. _-]+S(?<s>\d{1,2})E(?<e>\d{1,3})(?:-?E?(?<e2>\d{1,3}))?/i;
const TV_DAILY_RE = /^(?<show>.+?)[. _-]+(?<y>\d{4})\.(?<m>\d{2})\.(?<d>\d{2})/i;
const TV_ANIME_RE = /^(?<show>.+?)\s-\s(?<n>\d{2,4})(?:\s|\.|v\d|\[)/i;

function isVideo(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return VIDEO_EXT.has(ext) && !SKIP_PATTERNS.some((re) => re.test(name));
}

function isSub(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return SUB_EXT.has(ext);
}

function sanitize(s: string): string {
  return s.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").trim().replace(/\.+$/, "");
}

function listVideosRecursive(root: string, max = 4): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && isVideo(e.name)) out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

function listSubsRecursive(root: string, max = 4): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > max) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && isSub(e.name)) out.push(full);
    }
  };
  walk(root, 0);
  return out;
}

function parseTv(filename: string): { show: string; season: number; episode: number; episodeEnd?: number } | null {
  const base = path.basename(filename, path.extname(filename)).replace(/[._]/g, " ");
  const std = base.match(TV_STD_RE);
  if (std?.groups) {
    return {
      show: std.groups.show.trim(),
      season: Number(std.groups.s),
      episode: Number(std.groups.e),
      episodeEnd: std.groups.e2 ? Number(std.groups.e2) : undefined,
    };
  }
  const daily = base.match(TV_DAILY_RE);
  if (daily?.groups) {
    return {
      show: daily.groups.show.trim(),
      season: Number(daily.groups.y),
      episode: Number(daily.groups.m) * 100 + Number(daily.groups.d),
    };
  }
  const anime = base.match(TV_ANIME_RE);
  if (anime?.groups) {
    return { show: anime.groups.show.trim(), season: 1, episode: Number(anime.groups.n) };
  }
  return null;
}

function pathRoot(p: string): string {
  // On Windows: returns "F:\". On POSIX: returns "/".
  return path.parse(path.resolve(p)).root.toLowerCase();
}

function sameVolume(a: string, b: string): boolean {
  return pathRoot(a) === pathRoot(b);
}

function hardlinkIdempotent(src: string, dst: string): { linked: boolean; reason?: string } {
  // Make sure the dst directory exists
  fs.mkdirSync(path.dirname(dst), { recursive: true });

  if (fs.existsSync(dst)) {
    try {
      const ss = fs.statSync(src);
      const ds = fs.statSync(dst);
      if (ss.size === ds.size && ss.mtimeMs === ds.mtimeMs) {
        return { linked: true, reason: "already linked" };
      }
      // Replace mismatched destination
      fs.unlinkSync(dst);
    } catch (e: any) {
      return { linked: false, reason: e.message };
    }
  }

  try {
    fs.linkSync(src, dst);
    return { linked: true };
  } catch (e: any) {
    return { linked: false, reason: e.message };
  }
}

export type ImportResult = {
  ok: boolean;
  linkedFiles: { src: string; dst: string; isMain: boolean; sizeBytes: number }[];
  skipped: string[];
  error?: string;
};

/**
 * Import a completed torrent into the user's library.
 *
 *  - Reads category from the Download (substitutarr-movies / substitutarr-tv)
 *  - Walks `contentPath` for videos (skipping samples/nfo)
 *  - Hardlinks each video into the right library folder
 *  - Pairs subtitles next to their video by base name
 *  - Updates Media (movie status / episode files) and the Download row
 *  - Fires the Discord/webhook completion event
 *  - Triggers Jellyfin refresh
 */
export async function importCompletedTorrent(opts: {
  userId: string;
  downloadId: string;
  contentPath: string;
  category: string;
  torrentName: string;
}): Promise<ImportResult> {
  await connectMongo();
  const { userId, downloadId, contentPath, category, torrentName } = opts;

  if (!category.startsWith("substitutarr-")) {
    return { ok: false, linkedFiles: [], skipped: [], error: "category not managed by substitutarr" };
  }
  if (!fs.existsSync(contentPath)) {
    return { ok: false, linkedFiles: [], skipped: [], error: `contentPath missing: ${contentPath}` };
  }

  const settings = (await UserSettings.findOne({ userId }).lean()) as any;
  const moviesRoot = settings?.libraryPaths?.movies?.trim();
  const tvRoot = settings?.libraryPaths?.tv?.trim();
  if (!moviesRoot || !tvRoot) {
    return { ok: false, linkedFiles: [], skipped: [], error: "library paths not configured" };
  }

  // Same-volume check — hardlinks require src + dst on the same NTFS volume
  if (!sameVolume(contentPath, category === "substitutarr-movies" ? moviesRoot : tvRoot)) {
    return {
      ok: false,
      linkedFiles: [],
      skipped: [],
      error: `cross-volume: ${pathRoot(contentPath)} -> ${pathRoot(category === "substitutarr-movies" ? moviesRoot : tvRoot)}`,
    };
  }

  // Walk content path. Single file = treat as one-video torrent.
  const stat = fs.statSync(contentPath);
  const videos = stat.isDirectory()
    ? listVideosRecursive(contentPath)
    : isVideo(path.basename(contentPath))
      ? [contentPath]
      : [];
  const subs = stat.isDirectory() ? listSubsRecursive(contentPath) : [];

  if (videos.length === 0) {
    return { ok: false, linkedFiles: [], skipped: [], error: "no video files after filtering" };
  }

  // The biggest video is the "main" file
  const sized = videos.map((v) => ({ path: v, size: fs.statSync(v).size }));
  sized.sort((a, b) => b.size - a.size);
  const mainVideo = sized[0]!.path;

  const linkedFiles: ImportResult["linkedFiles"] = [];
  const skipped: string[] = [];

  for (const v of videos) {
    let dstDir: string;
    let dstFile: string;
    if (category === "substitutarr-movies") {
      dstDir = path.join(moviesRoot, sanitize(torrentName));
      dstFile = path.basename(v);
    } else {
      // TV: parse SxxExx → Show/Season NN/
      const tv = parseTv(path.basename(v));
      if (!tv) {
        skipped.push(`could not parse SxxExx: ${path.basename(v)}`);
        continue;
      }
      const showSafe = sanitize(tv.show);
      const seasonDir = `Season ${String(tv.season).padStart(2, "0")}`;
      dstDir = path.join(tvRoot, showSafe, seasonDir);
      dstFile = path.basename(v);
    }
    const dst = path.join(dstDir, dstFile);
    const r = hardlinkIdempotent(v, dst);
    if (r.linked) {
      linkedFiles.push({ src: v, dst, isMain: v === mainVideo, sizeBytes: fs.statSync(v).size });
    } else {
      skipped.push(`${path.basename(v)}: ${r.reason}`);
    }
  }

  // Pair subtitles next to videos by base name
  const videoBaseNames = new Set(videos.map((v) => path.basename(v, path.extname(v))));
  for (const s of subs) {
    const sBase = path.basename(s, path.extname(s));
    const bareBase = sBase.replace(/\.(fr|en|eng|fre|fra|spa|es|de|ger|ita|it|jp|ja|jpn)$/i, "");
    const match = videoBaseNames.has(sBase) ? sBase : videoBaseNames.has(bareBase) ? bareBase : null;
    if (!match) continue;
    const matchedVideo = videos.find((v) => path.basename(v, path.extname(v)) === match);
    if (!matchedVideo) continue;
    // Reuse the same destination directory the matched video was placed in
    const matched = linkedFiles.find((l) => l.src === matchedVideo);
    if (!matched) continue;
    const dst = path.join(path.dirname(matched.dst), path.basename(s));
    const r = hardlinkIdempotent(s, dst);
    if (r.linked) {
      linkedFiles.push({ src: s, dst, isMain: false, sizeBytes: fs.statSync(s).size });
    }
  }

  if (linkedFiles.length === 0) {
    return { ok: false, linkedFiles: [], skipped, error: "no files linked" };
  }

  // Find the Download row to get mediaId
  const dl = await Download.findById(downloadId).lean<any>();
  if (!dl) {
    log.warn("post-import: no Download row", { downloadId });
    return { ok: true, linkedFiles, skipped };
  }
  const mediaId = dl.mediaId;
  const main = linkedFiles.find((l) => l.isMain) ?? linkedFiles[0];

  // Persist Download
  await Download.updateOne(
    { _id: downloadId },
    { $set: { state: "completed", progress: 1, completedAt: new Date(), importedPath: main?.dst } },
  );

  // Update Media
  const media = await Media.findOne({ _id: mediaId, userId });
  if (media) {
    if (media.type === "movie") {
      media.status = "downloaded";
      await media.save();
    } else if (media.type === "tv") {
      let touched = 0;
      for (const f of linkedFiles) {
        const tv = parseTv(path.basename(f.src));
        if (!tv) continue;
        const season = media.seasons?.find((s: any) => s.number === tv.season);
        if (!season) continue;
        const eStart = tv.episode;
        const eEnd = tv.episodeEnd ?? eStart;
        for (let n = eStart; n <= eEnd; n++) {
          const ep = season.episodes?.find((e: any) => e.number === n);
          if (!ep) continue;
          ep.status = "downloaded";
          ep.file = { path: f.dst, sizeBytes: f.sizeBytes, importedAt: new Date() };
          touched++;
        }
      }
      if (touched > 0) await media.save();
    }
  }

  // Activity log
  void Activity.create({
    userId,
    mediaId,
    kind: "imported",
    title: torrentName,
    detail: `${linkedFiles.length} file(s) hardlinked -> library`,
  }).catch(() => {});

  // Jellyfin refresh (fire-and-forget)
  void (async () => {
    try {
      const jf = await getUserJellyfin(userId);
      if (jf) await jf.refreshAll();
    } catch (e: any) {
      log.warn("post-import: jellyfin refresh failed", { message: e.message });
    }
  })();

  // Outbound webhook (Discord + user-configured)
  if (media) {
    const epList: { season: number; episode: number }[] = [];
    if (media.type === "tv") {
      for (const f of linkedFiles) {
        const tv = parseTv(path.basename(f.src));
        if (!tv) continue;
        const eStart = tv.episode;
        const eEnd = tv.episodeEnd ?? eStart;
        for (let n = eStart; n <= eEnd; n++) epList.push({ season: tv.season, episode: n });
      }
    }
    void emitWebhook(userId, "request.completed", {
      type: media.type,
      mediaId: String(mediaId),
      tmdbId: media.tmdbId,
      title: media.title,
      year: media.year,
      poster: media.poster,
      episodes: epList.length ? epList : undefined,
      release: { title: torrentName },
      download: { qbHash: dl.qbHash, importedPath: main?.dst, fileCount: linkedFiles.length },
    }).catch(() => {});
  }

  return { ok: true, linkedFiles, skipped };
}
