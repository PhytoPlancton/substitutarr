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
 *  Trackers handle punctuation/diacritics inconsistently — some keep
 *  "Spider-Man: No Way Home", some "Spider-Man.No.Way.Home", some only
 *  "Spider-Man". For non-English films the title is sometimes only matched
 *  in its loose (ASCII alphanumeric) form. Generate the most permissive
 *  variants and let dedupe trim them.
 *
 *  FrankeinStream shadow run logged 16 "0 results across all variants"
 *  failures on French titles — these variants are designed to widen the net
 *  for that case without spamming the tracker.
 */
export function queryVariants(title: string): string[] {
  const original = title.trim();
  const t = normalize(title);
  const variants = new Set<string>([t]);
  if (original !== t) variants.add(original); // keep accented form too — some trackers index it

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
  // Hyphens: "Spider-Man" → "Spider Man" + "SpiderMan"
  if (/[-]/.test(t)) {
    variants.add(t.replace(/-/g, " "));
    variants.add(t.replace(/-/g, ""));
  }
  // Remove "(Year)" if present
  variants.add(t.replace(/\s*\(\d{4}\)\s*/g, " ").trim());
  // "The " prefix — some trackers index without leading article
  if (/^the\s/i.test(t)) variants.add(t.replace(/^the\s/i, ""));
  // "Le/La/Les " prefix for FR titles
  if (/^(le|la|les|l')\s?/i.test(t)) variants.add(t.replace(/^(le|la|les|l')\s?/i, ""));
  // Loose alnum — last-resort net (used when the title has weird unicode)
  const looseForm = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (looseForm && looseForm !== t.toLowerCase()) variants.add(looseForm);
  return [...variants].map((v) => v.trim()).filter(Boolean);
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
