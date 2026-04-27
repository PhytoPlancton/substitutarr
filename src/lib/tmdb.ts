const API_KEY = process.env.TMDB_API_KEY!;
const BASE = "https://api.themoviedb.org/3";

type TmdbResult = {
  id: number;
  media_type: "movie" | "tv";
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  overview?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
};

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!API_KEY) throw new Error("TMDB_API_KEY not set");
  const qs = new URLSearchParams({ language: "fr-FR", ...params });
  const cacheKey = `${path}?${qs}`;

  // Mongo TTL cache (24h) — protects TMDB rate limit (~40 req/sec) under load.
  try {
    const { connectMongo } = await import("./mongo");
    const { TmdbCache } = await import("@/models/TmdbCache");
    await connectMongo();
    const cached = await TmdbCache.findOne({ key: cacheKey }).lean<any>();
    if (cached?.payload) return cached.payload as T;
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${API_KEY}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`TMDB ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as T;
    // Fire-and-forget cache write
    TmdbCache.updateOne(
      { key: cacheKey },
      { $set: { key: cacheKey, payload: data, fetchedAt: new Date() } },
      { upsert: true },
    ).catch(() => {});
    return data;
  } catch {
    // If Mongo is down, still serve TMDB directly (don't lose functionality)
    const res = await fetch(`${BASE}${path}?${qs}`, {
      headers: { Authorization: `Bearer ${API_KEY}`, accept: "application/json" },
    });
    if (!res.ok) throw new Error(`TMDB ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }
}

export type SearchHit = {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  originalTitle?: string;
  originalLanguage?: string;
  year?: number;
  overview?: string;
  poster?: string | null;
  backdrop?: string | null;
  rating?: number;
};

const poster = (p?: string | null) => (p ? `https://image.tmdb.org/t/p/w500${p}` : null);
const backdrop = (p?: string | null) => (p ? `https://image.tmdb.org/t/p/w1280${p}` : null);

export async function searchMulti(query: string): Promise<SearchHit[]> {
  if (!query.trim()) return [];
  const data = await tmdb<{ results: TmdbResult[] }>("/search/multi", { query });
  return data.results
    .filter((r) => r.media_type === "movie" || r.media_type === "tv")
    .map((r) => ({
      tmdbId: r.id,
      type: r.media_type,
      title: (r.title ?? r.name)!,
      originalTitle: r.original_title ?? r.original_name,
      originalLanguage: r.original_language,
      year: (r.release_date ?? r.first_air_date)?.slice(0, 4)
        ? Number((r.release_date ?? r.first_air_date)!.slice(0, 4))
        : undefined,
      overview: r.overview,
      poster: poster(r.poster_path),
      backdrop: backdrop(r.backdrop_path),
      rating: r.vote_average,
    }))
    .filter((r) => r.title);
}

/** Year window: a release may be tagged with the FR theatrical year even if
 *  TMDB returns the international one. We accept ±1 by default, expanded by
 *  any year present in `release_dates` for movies. */
async function yearWindow(type: "movie" | "tv", id: number, baseYear?: number): Promise<{ min?: number; max?: number }> {
  if (!baseYear) return {};
  const window = { min: baseYear - 1, max: baseYear + 1 };
  if (type !== "movie") return window;
  try {
    const rd = await tmdb<any>(`/movie/${id}/release_dates`);
    const years: number[] = [];
    for (const country of rd.results ?? []) {
      for (const r of country.release_dates ?? []) {
        const y = Number((r.release_date ?? "").slice(0, 4));
        if (y) years.push(y);
      }
    }
    if (years.length) {
      window.min = Math.min(window.min, ...years) - 1;
      window.max = Math.max(window.max, ...years) + 1;
    }
  } catch {
    /* fall through with default ±1 */
  }
  return window;
}

/** Fetch alt titles in FR/US/GB — useful when original_title is in
 *  non-Latin script (anime, foreign films). */
async function alternativeTitles(type: "movie" | "tv", id: number): Promise<string[]> {
  try {
    const data = await tmdb<any>(`/${type}/${id}/alternative_titles`);
    const list = (type === "movie" ? data.titles : data.results) ?? [];
    return list
      .filter((t: any) => ["FR", "US", "GB"].includes(t.iso_3166_1))
      .map((t: any) => t.title)
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function getDetails(type: "movie" | "tv", id: number) {
  const data = await tmdb<any>(`/${type}/${id}`);
  const baseYear = Number(((type === "movie" ? data.release_date : data.first_air_date) || "").slice(0, 4)) || undefined;
  const yw = await yearWindow(type, id, baseYear);
  const altTitles = await alternativeTitles(type, id);
  return {
    tmdbId: data.id,
    type,
    title: type === "movie" ? data.title : data.name,
    originalTitle: type === "movie" ? data.original_title : data.original_name,
    originalLanguage: data.original_language,
    altTitles,
    year: ((type === "movie" ? data.release_date : data.first_air_date) || "").slice(0, 4),
    yearMin: yw.min,
    yearMax: yw.max,
    overview: data.overview,
    poster: poster(data.poster_path),
    backdrop: backdrop(data.backdrop_path),
    rating: data.vote_average,
    runtime: data.runtime,
    seasons:
      type === "tv"
        ? (data.seasons || [])
            .filter((s: any) => s.season_number > 0)
            .map((s: any) => ({
              number: s.season_number,
              episodes: Array.from({ length: s.episode_count }, (_, i) => ({
                number: i + 1,
                airDate: s.air_date,
              })),
            }))
        : undefined,
  };
}

export async function getEpisodes(id: number, season: number) {
  const data = await tmdb<any>(`/tv/${id}/season/${season}`);
  return (data.episodes || []).map((e: any) => ({
    number: e.episode_number,
    name: e.name,
    airDate: e.air_date,
  }));
}
