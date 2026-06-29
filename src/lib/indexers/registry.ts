import { connectMongo } from "@/lib/mongo";
import { Indexer as IndexerModel, type IndexerDoc } from "@/models/Indexer";
import type { Indexer, Release, SearchInput } from "./types";
import { YtsIndexer } from "./yts";
import { EztvIndexer } from "./eztv";
import { TorznabIndexer } from "./torznab";
import { parseRelease, type ParsedRelease } from "@/lib/release-parser";
import { scoreRelease, type ScoreBreakdown } from "@/lib/release-scoring";
import { queryVariants } from "@/lib/normalize";
import { recordHealth } from "@/lib/connection-health";
import { filterBlocked } from "@/lib/blocklist";
import type { ProfileDoc } from "@/models/Profile";

// ---- In-process search cache ----
// Many variants of the same title produce identical queries after tracker-side
// normalization (e.g. "Le Grand Bleu", "Grand Bleu", "le grand bleu" → same
// XML response). Caching the indexer.search() result for a few minutes cuts
// outbound request volume dramatically and dodges aggressive rate-limits.
const SEARCH_CACHE_TTL_MS = 10 * 60_000;
type CacheEntry = { releases: Release[]; expiresAt: number; error?: Error };
const searchCache = new Map<string, CacheEntry>();

function cacheKey(indexerId: string, input: SearchInput): string {
  return [
    indexerId,
    input.type,
    input.title?.toLowerCase().trim() ?? "",
    input.season ?? "",
    input.episode ?? "",
    input.tmdbId ?? "",
  ].join("|");
}

async function cachedSearch(
  indexerId: string,
  input: SearchInput,
  loader: () => Promise<Release[]>,
): Promise<Release[]> {
  const key = cacheKey(indexerId, input);
  const now = Date.now();
  const hit = searchCache.get(key);
  if (hit && hit.expiresAt > now) {
    if (hit.error) throw hit.error;
    return hit.releases;
  }
  try {
    const releases = await loader();
    searchCache.set(key, { releases, expiresAt: now + SEARCH_CACHE_TTL_MS });
    // Periodic gc — sweep expired entries when the map gets big
    if (searchCache.size > 256) {
      for (const [k, v] of searchCache) if (v.expiresAt <= now) searchCache.delete(k);
    }
    return releases;
  } catch (e: any) {
    // Cache failures too, but for a SHORTER window so a transient indexer
    // outage doesn't keep returning a stale error for 10 minutes.
    searchCache.set(key, { releases: [], expiresAt: now + 30_000, error: e });
    throw e;
  }
}

type IndexerWithId = { id: string; name: string; indexer: Indexer };

function build(doc: IndexerDoc): Indexer | null {
  switch (doc.kind) {
    case "yts":
      return new YtsIndexer(doc.url || undefined);
    case "eztv":
      return new EztvIndexer(doc.url || undefined);
    case "torznab":
      if (!doc.url || !doc.apiKey) return null;
      return new TorznabIndexer(doc.name, doc.url, doc.apiKey, doc.categories);
    default:
      return null;
  }
}

async function listIndexersWithId(userId: string): Promise<IndexerWithId[]> {
  await connectMongo();
  const docs = (await IndexerModel.find({ userId, enabled: true })
    .sort({ priority: -1 })
    .lean()) as unknown as (IndexerDoc & { _id: any })[];
  const out: IndexerWithId[] = [];
  for (const d of docs) {
    const indexer = build(d);
    if (indexer) out.push({ id: d._id.toString(), name: d.name, indexer });
  }
  return out;
}

export async function listIndexers(userId: string): Promise<Indexer[]> {
  return (await listIndexersWithId(userId)).map((x) => x.indexer);
}

export type ScoredRelease = Release & {
  parsed: ParsedRelease;
  scoreBreakdown: ScoreBreakdown;
};

export type SearchAllResult = {
  releases: ScoredRelease[];
  rejected: { release: Release; reason: string }[];
  errors: { indexer: string; message: string }[];
};

export async function searchAll(
  userId: string,
  input: SearchInput & { altTitles?: string[]; yearMin?: number; yearMax?: number },
  profile: ProfileDoc,
): Promise<SearchAllResult> {
  const pairs = await listIndexersWithId(userId);
  if (pairs.length === 0)
    return { releases: [], rejected: [], errors: [{ indexer: "(none)", message: "no enabled indexers configured" }] };

  // Generate title variants. Trackers handle ":" / apostrophes / non-Latin
  // scripts inconsistently — try all reasonable forms and merge.
  const titleSet = new Set<string>();
  for (const v of queryVariants(input.title)) titleSet.add(v);
  for (const alt of input.altTitles ?? []) for (const v of queryVariants(alt)) titleSet.add(v);
  // Cap = 8 (was 4): FrankeinStream's shadow run found 16/46 failures where
  // the right variant wasn't in the first 4. Trackers handle 8 queries fine,
  // and dedupe makes most variants free (same query merges).
  const titlesToTry = [...titleSet].slice(0, 8);

  const errors: SearchAllResult["errors"] = [];
  const raw: Release[] = [];

  // Fan out: each (indexer, title-variant) pair, in parallel.
  // Each leg goes through a short-lived in-process cache so the same query
  // doesn't hammer the indexer twice within `SEARCH_CACHE_TTL_MS`. With 8
  // title variants + 3 indexers = 24 legs per request, and most variants
  // collapse to the same result set, the cache typically slashes outbound
  // request volume 3-5x and helps avoid tripping rate-limits.
  const tasks = pairs.flatMap((p) => titlesToTry.map((title) => ({ p, title })));
  const settled = await Promise.allSettled(
    tasks.map(({ p, title }) =>
      cachedSearch(p.id, { ...input, title }, () => p.indexer.search({ ...input, title })),
    ),
  );

  // Aggregate per-indexer outcome — if ANY variant succeeds, indexer is healthy.
  const perIndexer = new Map<
    string,
    { name: string; ok: boolean; firstError?: string; releases: number }
  >();

  settled.forEach((r, i) => {
    const { p, title } = tasks[i];
    const existing = perIndexer.get(p.id) ?? { name: p.name, ok: false, releases: 0 };
    if (r.status === "fulfilled") {
      raw.push(...r.value);
      existing.ok = true;
      existing.releases += r.value.length;
    } else {
      const msg = r.reason?.message ?? String(r.reason);
      if (!existing.firstError) existing.firstError = msg;
      errors.push({ indexer: `${p.name}/"${title}"`, message: msg });
    }
    perIndexer.set(p.id, existing);
  });

  // Record health for each indexer based on actual usage outcome.
  // Successful real searches make explicit "Test connection" optional.
  for (const [id, agg] of perIndexer) {
    void recordHealth({
      userId,
      service: `indexer:${id}`,
      ok: agg.ok,
      detail: agg.ok ? `${agg.releases} releases` : agg.firstError,
    });
  }

  // Dedupe by infoHash (best seeders win)
  const byKey = new Map<string, Release>();
  for (const r of raw) {
    const key = (r.infoHash ?? r.title).toLowerCase();
    const prev = byKey.get(key);
    if (!prev || (r.seeders ?? 0) > (prev.seeders ?? 0)) byKey.set(key, r);
  }

  // Filter blocked releases — never retry something the user/auto-blocked
  const beforeBlock = [...byKey.values()];
  const afterBlock = await filterBlocked(userId, beforeBlock);
  if (afterBlock.length < beforeBlock.length) {
    errors.push({
      indexer: "(blocklist)",
      message: `${beforeBlock.length - afterBlock.length} blocked release${beforeBlock.length - afterBlock.length > 1 ? "s" : ""} excluded`,
    });
  }

  // Year-tolerance filter (uses TMDB release_dates window if provided)
  const yMin = input.yearMin;
  const yMax = input.yearMax;

  const accepted: ScoredRelease[] = [];
  const rejected: { release: Release; reason: string }[] = [];
  for (const r of afterBlock) {
    const parsed = parseRelease(r.title, { sizeBytes: r.sizeBytes, seeders: r.seeders });
    if (parsed.year && yMin && yMax && (parsed.year < yMin || parsed.year > yMax)) {
      rejected.push({ release: r, reason: `year ${parsed.year} outside [${yMin}, ${yMax}]` });
      continue;
    }
    const breakdown = scoreRelease(profile, parsed);
    if (breakdown.rejected) {
      rejected.push({ release: r, reason: breakdown.rejected });
      continue;
    }
    accepted.push({ ...r, parsed, scoreBreakdown: breakdown, score: breakdown.total });
  }
  if (accepted.length === 0 && rejected.length === 0)
    errors.push({ indexer: "(all)", message: "0 results across all variants" });
  accepted.sort((a, b) => b.scoreBreakdown.total - a.scoreBreakdown.total);
  return { releases: accepted, rejected, errors };
}
