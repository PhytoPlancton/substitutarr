import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { searchMulti, getDetails } from "@/lib/tmdb";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

const Schema = z.object({
  rootPath: z.string().min(1),
  type: z.enum(["movie", "tv"]),
  /** When true, write Media docs as `downloaded` with file paths.
   *  When false (default), return matches without persisting. */
  apply: z.boolean().default(false),
});

const VIDEO_EXT = /\.(mkv|mp4|avi|m4v|mov|webm|ts|wmv)$/i;
const SAMPLE = /(^|[^a-z])sample([^a-z]|$)/i;

const MOVIE_RE = /^(?<title>.+?)[. _]\(?(?<year>(19|20)\d{2})\)?/i;
const TV_FILE_RE = /^(?<show>.+?)[. _]S(?<season>\d{1,2})E(?<episode>\d{1,3})/i;
const SHOW_FOLDER_RE = /^(?<show>.+?)(?:[. _]\(?(?<year>(19|20)\d{2})\)?)?$/i;

type Match = {
  path: string;
  parsedTitle: string;
  parsedYear?: number;
  season?: number;
  episode?: number;
  tmdbId?: number;
  tmdbTitle?: string;
  matched: boolean;
  error?: string;
};

function listVideos(dir: string, depth = 0, max = 4): string[] {
  if (depth > max) return [];
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...listVideos(full, depth + 1, max));
    } else if (e.isFile() && VIDEO_EXT.test(e.name) && !SAMPLE.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

function parseMovieFromPath(p: string): { title: string; year?: number } | null {
  // Try the parent folder first (Radarr-style "Title (YYYY)/")
  const parent = path.basename(path.dirname(p));
  const filename = path.basename(p, path.extname(p));
  for (const cand of [parent, filename]) {
    const m = cand.replace(/[._]/g, " ").match(MOVIE_RE);
    if (m?.groups?.title) {
      return {
        title: m.groups.title.trim().replace(/\s+/g, " "),
        year: m.groups.year ? Number(m.groups.year) : undefined,
      };
    }
  }
  return null;
}

function parseTvFromPath(p: string): { show: string; year?: number; season: number; episode: number } | null {
  const filename = path.basename(p, path.extname(p));
  const m = filename.replace(/[._]/g, " ").match(TV_FILE_RE);
  if (!m?.groups) return null;
  // Show name often comes from the grand-parent ("Show Name/Season 03/...")
  let show = m.groups.show.trim().replace(/\s+/g, " ");
  let year: number | undefined;
  const grand = path.basename(path.dirname(path.dirname(p)));
  const grandMatch = grand.replace(/[._]/g, " ").match(SHOW_FOLDER_RE);
  if (grandMatch?.groups?.show) {
    show = grandMatch.groups.show.trim().replace(/\s+/g, " ");
    if (grandMatch.groups.year) year = Number(grandMatch.groups.year);
  }
  return {
    show,
    year,
    season: Number(m.groups.season),
    episode: Number(m.groups.episode),
  };
}

async function tmdbBest(query: string, year: number | undefined, want: "movie" | "tv"): Promise<{ id: number; title: string } | null> {
  const hits = await searchMulti(query).catch(() => []);
  const filtered = hits.filter((h) => h.type === want);
  if (filtered.length === 0) return null;
  // Prefer year match
  if (year) {
    const matched = filtered.find((h) => h.year === year);
    if (matched) return { id: matched.tmdbId, title: matched.title };
  }
  return { id: filtered[0].tmdbId, title: filtered[0].title };
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { rootPath, type, apply } = parsed.data;

  // Defense-in-depth — refuse paths that don't exist or aren't directories
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rootPath);
  } catch (e: any) {
    return NextResponse.json({ error: `cannot stat: ${e.message}` }, { status: 400 });
  }
  if (!stat.isDirectory()) return NextResponse.json({ error: "rootPath must be a directory" }, { status: 400 });

  const videos = listVideos(rootPath);
  if (videos.length === 0) return NextResponse.json({ scanned: 0, matches: [] });

  await connectMongo();

  const matches: Match[] = [];
  // For TV, group by show+year to make N TMDB lookups, not N×episodes
  const tvGroups = new Map<string, { show: string; year?: number; episodes: { season: number; episode: number; path: string }[] }>();

  for (const filepath of videos) {
    if (type === "movie") {
      const parsed = parseMovieFromPath(filepath);
      if (!parsed) {
        matches.push({ path: filepath, parsedTitle: path.basename(filepath), matched: false, error: "could not parse" });
        continue;
      }
      const hit = await tmdbBest(parsed.title, parsed.year, "movie");
      matches.push({
        path: filepath,
        parsedTitle: parsed.title,
        parsedYear: parsed.year,
        tmdbId: hit?.id,
        tmdbTitle: hit?.title,
        matched: !!hit,
      });
    } else {
      const parsed = parseTvFromPath(filepath);
      if (!parsed) {
        matches.push({ path: filepath, parsedTitle: path.basename(filepath), matched: false, error: "could not parse SxxExx" });
        continue;
      }
      const key = `${parsed.show.toLowerCase()}::${parsed.year ?? ""}`;
      let group = tvGroups.get(key);
      if (!group) {
        group = { show: parsed.show, year: parsed.year, episodes: [] };
        tvGroups.set(key, group);
      }
      group.episodes.push({ season: parsed.season, episode: parsed.episode, path: filepath });
    }
  }

  // Resolve TV groups
  for (const group of tvGroups.values()) {
    const hit = await tmdbBest(group.show, group.year, "tv");
    for (const ep of group.episodes) {
      matches.push({
        path: ep.path,
        parsedTitle: group.show,
        parsedYear: group.year,
        season: ep.season,
        episode: ep.episode,
        tmdbId: hit?.id,
        tmdbTitle: hit?.title,
        matched: !!hit,
      });
    }
  }

  if (!apply) {
    return NextResponse.json({ scanned: videos.length, matches });
  }

  // Apply: persist Media records + flag episodes/movies as downloaded
  const applied: { tmdbId: number; type: string; touched: number }[] = [];
  if (type === "movie") {
    const moviesByTmdb = new Map<number, Match[]>();
    for (const m of matches) {
      if (!m.matched || !m.tmdbId) continue;
      const list = moviesByTmdb.get(m.tmdbId) ?? [];
      list.push(m);
      moviesByTmdb.set(m.tmdbId, list);
    }
    for (const [tmdbId, group] of moviesByTmdb) {
      try {
        const details = await getDetails("movie", tmdbId);
        const main = group[0];
        await Media.findOneAndUpdate(
          { userId, type: "movie", tmdbId },
          {
            $setOnInsert: { userId, type: "movie", tmdbId },
            $set: {
              title: details.title,
              year: details.year ? Number(details.year) : undefined,
              overview: details.overview,
              poster: details.poster,
              backdrop: details.backdrop,
              status: "downloaded",
            },
          },
          { upsert: true },
        );
        applied.push({ tmdbId, type: "movie", touched: 1 });
      } catch (e: any) {
        log.warn("import movie failed", { tmdbId, message: e.message });
      }
    }
  } else {
    const showsByTmdb = new Map<number, Match[]>();
    for (const m of matches) {
      if (!m.matched || !m.tmdbId) continue;
      const list = showsByTmdb.get(m.tmdbId) ?? [];
      list.push(m);
      showsByTmdb.set(m.tmdbId, list);
    }
    for (const [tmdbId, eps] of showsByTmdb) {
      try {
        const details = await getDetails("tv", tmdbId);
        const media = await Media.findOneAndUpdate(
          { userId, type: "tv", tmdbId },
          {
            $setOnInsert: { userId, type: "tv", tmdbId },
            $set: {
              title: details.title,
              year: details.year ? Number(details.year) : undefined,
              overview: details.overview,
              poster: details.poster,
              backdrop: details.backdrop,
              seasons: details.seasons,
            },
          },
          { upsert: true, new: true },
        );
        let touched = 0;
        for (const ep of eps) {
          if (ep.season == null || ep.episode == null) continue;
          const season = media.seasons?.find((s: any) => s.number === ep.season);
          if (!season) continue;
          const episode = season.episodes?.find((e: any) => e.number === ep.episode);
          if (!episode) continue;
          episode.status = "downloaded";
          let size: number | undefined;
          try {
            size = fs.statSync(ep.path).size;
          } catch {
            /* keep size undefined */
          }
          episode.file = {
            path: ep.path,
            sizeBytes: size,
            importedAt: new Date(),
          };
          touched++;
        }
        if (touched > 0) await media.save();
        applied.push({ tmdbId, type: "tv", touched });
      } catch (e: any) {
        log.warn("import tv failed", { tmdbId, message: e.message });
      }
    }
  }

  return NextResponse.json({
    scanned: videos.length,
    applied,
    matches,
  });
}
