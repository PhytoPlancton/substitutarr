import { type ParsedRelease, type Resolution } from "./release-parser";
import type { ProfileDoc } from "@/models/Profile";

export type ScoreBreakdown = {
  total: number;
  reasons: { source: string; points: number }[];
  rejected?: string;
};

const RES_ORDER: Resolution[] = ["SD", "480p", "720p", "1080p", "2160p"];

function resAtLeast(res: Resolution | undefined, min: string | undefined): boolean {
  if (!min) return true;
  if (!res) return false;
  return RES_ORDER.indexOf(res) >= RES_ORDER.indexOf(min as Resolution);
}
function resAtMost(res: Resolution | undefined, max: string | undefined): boolean {
  if (!max) return true;
  if (!res) return true;
  return RES_ORDER.indexOf(res) <= RES_ORDER.indexOf(max as Resolution);
}

/**
 * Apply a profile's hard filters to a parsed release.
 * Returns null if release passes, else a string explaining why it was rejected.
 */
export function checkFilters(p: ProfileDoc, r: ParsedRelease): string | null {
  const f: any = p.filters ?? {};

  if (!resAtLeast(r.resolution, f.minResolution as string | undefined))
    return `resolution ${r.resolution ?? "unknown"} < min ${f.minResolution}`;
  if (!resAtMost(r.resolution, f.maxResolution as string | undefined))
    return `resolution ${r.resolution} > max ${f.maxResolution}`;

  if (typeof f.minSeeders === "number" && (r.seeders ?? 0) < f.minSeeders)
    return `seeders ${r.seeders ?? 0} < min ${f.minSeeders}`;

  if (r.sizeBytes) {
    const mb = r.sizeBytes / 1e6;
    if (f.minSizeMB && mb < f.minSizeMB) return `size ${mb.toFixed(0)} MB < min ${f.minSizeMB}`;
    if (f.maxSizeMB && mb > f.maxSizeMB) return `size ${mb.toFixed(0)} MB > max ${f.maxSizeMB}`;
  }

  const requireLangs = (f.requireLanguages ?? []) as string[];
  if (requireLangs.length && !requireLangs.some((l) => r.languages.includes(l as any)))
    return `no required language (need one of ${requireLangs.join(", ")})`;

  const blockedLangs = (f.blockedLanguages ?? []) as string[];
  if (blockedLangs.some((l) => r.languages.includes(l as any)))
    return `contains blocked language`;

  const blockedSrc = (f.blockedSources ?? []) as string[];
  if (r.source && blockedSrc.includes(r.source)) return `source ${r.source} is blocked`;

  const blockedKw = (f.blockedKeywords ?? []) as string[];
  for (const kw of blockedKw) if (kw && r.raw.toLowerCase().includes(kw.toLowerCase()))
    return `contains blocked keyword "${kw}"`;

  const requireKw = (f.requireKeywords ?? []) as string[];
  if (requireKw.length && !requireKw.some((kw) => kw && r.raw.toLowerCase().includes(kw.toLowerCase())))
    return `missing required keyword (one of ${requireKw.join(", ")})`;

  if (f.requireHDR && (r.hdr === "SDR" || !r.hdr)) return `HDR required, got SDR`;
  if (f.blockHardcoded && r.hardcodedSubs) return `hardcoded subtitles`;

  if ((p.blockedGroups ?? []).map((s: string) => s.toUpperCase()).includes(r.group ?? ""))
    return `group ${r.group} blocked`;

  return null;
}

const lookup = (m: any, key: any): number => {
  if (!m || key == null) return 0;
  const v = m[key as any];
  return typeof v === "number" ? v : 0;
};

export function scoreRelease(p: ProfileDoc, r: ParsedRelease): ScoreBreakdown {
  const filterFail = checkFilters(p, r);
  if (filterFail) return { total: -Infinity, reasons: [], rejected: filterFail };

  const reasons: ScoreBreakdown["reasons"] = [];
  const w: any = p.weights ?? {};
  const add = (source: string, points: number) => {
    if (points) reasons.push({ source, points });
  };

  if (r.resolution) add(`res ${r.resolution}`, lookup(w.resolution, r.resolution));
  if (r.source) add(`source ${r.source}`, lookup(w.source, r.source));
  if (r.codec) add(`codec ${r.codec}`, lookup(w.codec, r.codec));
  if (r.bitDepth !== "unknown") add(`bit ${r.bitDepth}`, lookup(w.bitDepth, r.bitDepth));
  if (r.hdr) add(`hdr ${r.hdr}`, lookup(w.hdr, r.hdr));
  if (r.audioCodec) add(`audio ${r.audioCodec}`, lookup(w.audioCodec, r.audioCodec));
  if (r.audioChannels) add(`channels ${r.audioChannels}`, lookup(w.audioChannels, r.audioChannels));
  if (r.hasAtmos) add("atmos", w.atmos ?? 0);

  // Pick the best-scoring language present (avoid stacking VFF + FRENCH)
  let bestLang = 0;
  for (const lang of r.languages) bestLang = Math.max(bestLang, lookup(w.language, lang));
  if (bestLang) add(`lang`, bestLang);

  for (const cut of r.cuts) add(`cut ${cut}`, lookup(w.cut, cut));
  for (const tag of r.qualityTags) add(`tag ${tag}`, lookup(w.tag, tag));
  for (const pen of r.penalties) add(`penalty ${pen}`, lookup(w.penalty, pen));

  // PROPER/REPACK upgrade: more recent fixes outrank originals
  if (r.properLevel > 0) add(`PROPER level ${r.properLevel}`, r.properLevel * 8);
  // Multi-episode files: bonus per additional episode covered
  if (r.episodeEnd && r.episode && r.episodeEnd > r.episode) {
    add(`multi-ep ${r.episode}-${r.episodeEnd}`, (r.episodeEnd - r.episode) * 5);
  }
  // Season pack: small bonus when grabbing for "season-wide" intent.
  // Concrete pack-vs-episode strategy lives in grab.ts; here we only nudge.
  if (r.isSeasonPack) add("season pack", 8);

  if (r.source && ["CAM", "TS", "HDCAM", "TC"].includes(r.source))
    add(`source ${r.source} penalty`, lookup(w.penalty, r.source));

  // Group reputation
  const g = (r.group ?? "").toUpperCase();
  if (g) {
    const t1 = (p.preferredGroupsTier1 ?? []).map((s: string) => s.toUpperCase());
    const t2 = (p.preferredGroupsTier2 ?? []).map((s: string) => s.toUpperCase());
    if (t1.includes(g)) add(`group tier-1 ${r.group}`, p.groupTier1Bonus ?? 0);
    else if (t2.includes(g)) add(`group tier-2 ${r.group}`, p.groupTier2Bonus ?? 0);
  }

  // Seeders bonus (logarithmic — first seeders matter more)
  if (r.seeders) {
    const bonus = Math.round(Math.log2(r.seeders + 1) * (w.seedersBonus ?? 0));
    if (bonus) add(`seeders x${r.seeders}`, bonus);
  }

  const total = reasons.reduce((s, r) => s + r.points, 0);
  return { total, reasons };
}

/**
 * Pick the best release from a list according to the profile.
 * Returns null if none pass the filters.
 */
export function pickBest<R extends ParsedRelease>(
  p: ProfileDoc,
  releases: R[],
): { release: R; score: ScoreBreakdown } | null {
  let best: { release: R; score: ScoreBreakdown } | null = null;
  for (const r of releases) {
    const s = scoreRelease(p, r);
    if (s.rejected) continue;
    if (!best || s.total > best.score.total) best = { release: r, score: s };
  }
  return best;
}
