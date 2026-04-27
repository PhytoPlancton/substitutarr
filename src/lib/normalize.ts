/**
 * Title normalization utilities for matching across TMDB <-> indexer release names.
 * Handles diacritics, smart quotes, special chars, and produces query variants
 * that work across French/English trackers.
 */

const SMART_QUOTES = /[\u2018\u2019\u02BC\u201C\u201D]/g;
const ZERO_WIDTH = /[\u00A0\u200B-\u200D\uFEFF]/g;

/** Strip diacritics (é → e, î → i), normalize smart quotes, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(SMART_QUOTES, "")
    .replace(ZERO_WIDTH, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Aggressive normalize for fuzzy match: lowercase + remove all non-alnum. */
export function loose(s: string): string {
  return normalize(s).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Generate query variants for indexer search.
 *  Trackers handle ":" inconsistently — some keep "Spider-Man No Way Home",
 *  some "Spider-Man.No.Way.Home", some only "Spider-Man". Try the most
 *  permissive first. */
export function queryVariants(title: string): string[] {
  const t = normalize(title);
  const variants = new Set<string>([t]);
  // Colon handling
  if (t.includes(":")) {
    variants.add(t.replace(/:/g, " "));
    variants.add(t.replace(/:\s*/g, " - "));
    variants.add(t.split(":")[0].trim()); // "Avatar"
    variants.add(t.split(":").slice(1).join(":").trim()); // "The Way of Water"
  }
  // Apostrophes: "L'Émission" → "LEmission" or "L Emission"
  if (/['']/.test(t)) {
    variants.add(t.replace(/['']/g, ""));
    variants.add(t.replace(/['']/g, " "));
  }
  // Remove "(Year)" if present
  variants.add(t.replace(/\s*\(\d{4}\)\s*/g, " ").trim());
  return [...variants].filter(Boolean);
}

/** Strip the TMDB title from a release name to safely extract the year.
 *  Avoids "Blade Runner 2049 (2017)" → year=2049 trap. */
export function extractYear(releaseTitle: string, knownTitle?: string): number | undefined {
  let s = releaseTitle;
  if (knownTitle) {
    const escaped = normalize(knownTitle).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(escaped, "gi"), " ");
  }
  // Years 1900-2049 (no future fluff)
  const matches = [...s.matchAll(/\b(19\d{2}|20[0-4]\d)\b/g)];
  if (matches.length === 0) return undefined;
  // If multiple matches, prefer the LAST one (year-in-title is usually first)
  return Number(matches[matches.length - 1][1]);
}

/** Check if a release title is plausibly the same as the known TMDB title.
 *  Returns 0..1 similarity. Useful for short titles like "Heat", "9", "Up". */
export function titleSimilarity(release: string, known: string): number {
  const a = loose(release);
  const b = loose(known);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  if (a.includes(b) || b.includes(a)) return 0.75;
  // Jaro-like char overlap (lightweight, no full Jaro-Winkler)
  const aSet = new Set(a);
  const overlap = [...b].filter((c) => aSet.has(c)).length;
  return overlap / Math.max(a.length, b.length);
}
