/**
 * Lightweight quality/source extraction used by indexer adapters
 * to populate `Release.quality`/`source` shorthand fields.
 *
 * The full structured parsing (codec, HDR, audio, language, group, …)
 * lives in `lib/release-parser.ts` and is consumed by the scoring engine.
 */
const QUALITIES: { re: RegExp; quality: string }[] = [
  { re: /\b2160p|4k|uhd\b/i, quality: "2160p" },
  { re: /\b1080p\b/i, quality: "1080p" },
  { re: /\b720p\b/i, quality: "720p" },
  { re: /\b480p\b/i, quality: "480p" },
];

const SOURCES: { re: RegExp; name: string }[] = [
  { re: /\bremux\b/i, name: "remux" },
  { re: /\bbluray|bdrip|brrip\b/i, name: "bluray" },
  { re: /\bweb-?dl|web-?rip|webrip\b/i, name: "web" },
  { re: /\bhdtv\b/i, name: "hdtv" },
  { re: /\bdvdrip\b/i, name: "dvd" },
  { re: /\bcam\b/i, name: "cam" },
];

export function parseQuality(title: string): { quality?: string; source?: string } {
  const quality = QUALITIES.find((p) => p.re.test(title))?.quality;
  const source = SOURCES.find((p) => p.re.test(title))?.name;
  return { quality, source };
}
