/**
 * Pure parser: torrent release title → typed dimensions.
 * No filesystem / network. Good test target later.
 */

export type Resolution = "2160p" | "1080p" | "720p" | "480p" | "SD";
export type Source =
  | "REMUX"
  | "BLURAY"
  | "WEB-DL"
  | "WEBRIP"
  | "BDRIP"
  | "BRRIP"
  | "HDTV"
  | "DVDRIP"
  | "HDRIP"
  | "DVDSCR"
  | "TC"
  | "TS"
  | "HDCAM"
  | "CAM";
export type Codec = "AV1" | "x265" | "x264" | "VP9" | "XVID";
export type BitDepth = "10bit" | "8bit" | "unknown";
export type HDR = "DV-FEL" | "DV-MEL" | "DV" | "HDR10+" | "HDR10" | "HLG" | "SDR";
export type AudioCodec =
  | "TRUEHD"
  | "DTS-X"
  | "DTS-HD-MA"
  | "DTS-HD-HRA"
  | "DTS"
  | "EAC3"
  | "AC3"
  | "AAC"
  | "FLAC"
  | "OPUS"
  | "MP3";
export type Channels = "9.1.6" | "7.1.4" | "7.1" | "5.1" | "2.1" | "2.0";
export type Language =
  | "VFF"
  | "TRUEFRENCH"
  | "VFI"
  | "VFQ"
  | "VF2"
  | "VOF"
  | "FRENCH"
  | "MULTI"
  | "DUAL"
  | "VOSTFR"
  | "VOST"
  | "VO";
export type Cut =
  | "EXTENDED"
  | "THEATRICAL"
  | "DIRECTORS-CUT"
  | "UNRATED"
  | "IMAX"
  | "FINAL-CUT"
  | "REMASTERED"
  | "OPEN-MATTE"
  | "REDUX"
  | "ULTIMATE";
export type QualityTag = "REPACK" | "PROPER" | "REAL-PROPER" | "RERIP" | "FIXED" | "INTERNAL" | "READNFO" | "LIMITED" | "COMPLETE";
export type Provider = "AMZN" | "NF" | "DSNP" | "HMAX" | "ATVP" | "iT" | "HULU" | "STAN" | "PCOK" | "MA";

export type Penalty = "CAM-FAKE" | "LITE" | "HARDCODED" | "YIFY" | "RARBG-FAKE" | "TINY-1080P" | "TINY-2160P";

export type ParsedRelease = {
  raw: string;
  title?: string;
  year?: number;
  resolution?: Resolution;
  source?: Source;
  codec?: Codec;
  bitDepth: BitDepth;
  hdr?: HDR;
  audioCodec?: AudioCodec;
  audioChannels?: Channels;
  hasAtmos: boolean;
  languages: Language[];
  cuts: Cut[];
  qualityTags: QualityTag[];
  provider?: Provider;
  group?: string;
  season?: number;
  episode?: number;
  /** Last episode in a multi-ep file (S01E01-E02 → episode=1, episodeEnd=2). */
  episodeEnd?: number;
  /** Anime absolute episode number when no SxxExx tag (One Piece 1085). */
  absoluteEpisode?: number;
  airDate?: string; // YYYY-MM-DD (for daily shows)
  /** True when release is a season pack (S01.COMPLETE, Saison.1, S01 without E). */
  isSeasonPack: boolean;
  isCompleteSeason: boolean;
  /** Higher = more recent fix. 0=plain release, 1=PROPER/REPACK, 2=REPACK2/REAL.PROPER */
  properLevel: number;
  hardcodedSubs: boolean;
  penalties: Penalty[];
  /** From indexer, not parsed: */
  sizeBytes?: number;
  seeders?: number;
  durationMin?: number;
};

const norm = (s: string) => s.replace(/[\s._-]+/g, ".");
const has = (s: string, re: RegExp) => re.test(s);

const RES_PATTERNS: [RegExp, Resolution][] = [
  [/\b(?:4320p|8k)\b/i, "2160p"],
  [/\b(?:2160p|4k|uhd)\b/i, "2160p"],
  [/\b1440p\b/i, "1080p"],
  [/\b1080p\b/i, "1080p"],
  [/\b720p\b/i, "720p"],
  [/\b(?:576p|480p)\b/i, "480p"],
];

const SOURCE_PATTERNS: [RegExp, Source][] = [
  [/\b(?:bluray|bd)[\s._-]*remux\b/i, "REMUX"],
  [/\bremux\b/i, "REMUX"],
  [/\bbluray\b|\bblu-?ray\b|\bbdrom\b|\bbd25\b|\bbd50\b/i, "BLURAY"],
  [/\bweb[\s._-]?dl\b/i, "WEB-DL"],
  [/\bwebrip\b/i, "WEBRIP"],
  [/\bbdrip\b/i, "BDRIP"],
  [/\bbrrip\b/i, "BRRIP"],
  [/\bhdtv\b/i, "HDTV"],
  [/\bdvdrip\b/i, "DVDRIP"],
  [/\bhdrip\b/i, "HDRIP"],
  [/\bdvdscr\b|\bscreener\b/i, "DVDSCR"],
  [/\btelecine\b|\btc\b/i, "TC"],
  [/\btelesync\b|\bts\b/i, "TS"],
  [/\bhdcam\b/i, "HDCAM"],
  [/\bcam\b/i, "CAM"],
];

const CODEC_PATTERNS: [RegExp, Codec][] = [
  [/\bav1\b/i, "AV1"],
  [/\b(?:x265|h\.?265|hevc)\b/i, "x265"],
  [/\b(?:x264|h\.?264|avc)\b/i, "x264"],
  [/\bvp9\b/i, "VP9"],
  [/\b(?:xvid|divx)\b/i, "XVID"],
];

const HDR_PATTERNS: [RegExp, HDR][] = [
  [/\b(?:dolby[\s._-]?vision|dovi|dv)[\s._-]*(?:p?7|fel|full[\s._-]?enhancement)\b/i, "DV-FEL"],
  [/\b(?:dolby[\s._-]?vision|dovi|dv)[\s._-]*(?:p?7|mel|minimal[\s._-]?enhancement)\b/i, "DV-MEL"],
  [/\b(?:dolby[\s._-]?vision|dovi|\bdv\b)/i, "DV"],
  [/\bhdr10\+\b|\bhdr10plus\b/i, "HDR10+"],
  [/\bhdr10\b|\bhdr\b/i, "HDR10"],
  [/\bhlg\b/i, "HLG"],
];

const AUDIO_PATTERNS: [RegExp, AudioCodec][] = [
  [/\btrue[\s._-]?hd\b/i, "TRUEHD"],
  [/\bdts[\s._-]?x\b/i, "DTS-X"],
  [/\bdts[\s._-]?hd[\s._-]?ma\b/i, "DTS-HD-MA"],
  [/\bdts[\s._-]?hd[\s._-]?hra?\b/i, "DTS-HD-HRA"],
  [/\bdts\b/i, "DTS"],
  [/\b(?:eac3|ddp|dd\+|e-ac-?3)\b/i, "EAC3"],
  [/\b(?:ac3|dd5\.1|dd2\.0|\bdd\b)/i, "AC3"],
  [/\baac\b/i, "AAC"],
  [/\bflac\b/i, "FLAC"],
  [/\bopus\b/i, "OPUS"],
  [/\bmp3\b/i, "MP3"],
];

const CHANNELS_PATTERNS: [RegExp, Channels][] = [
  [/\b9\.1\.6\b/, "9.1.6"],
  [/\b7\.1\.4\b/, "7.1.4"],
  [/\b7\.1\b/, "7.1"],
  [/\b5\.1\b/, "5.1"],
  [/\b2\.1\b/, "2.1"],
  [/\b2\.0\b/, "2.0"],
];

const LANG_PATTERNS: [RegExp, Language][] = [
  // Order matters: more specific tags first (TRUEFRENCH before FRENCH)
  [/\btruefrench\b/i, "TRUEFRENCH"],
  [/\bvff\b/i, "VFF"],
  [/\bvfi\b/i, "VFI"],
  [/\bvfq\b/i, "VFQ"],
  [/\bvf2\b/i, "VF2"],
  [/\bvof\b/i, "VOF"],
  [/\bvostfr\b/i, "VOSTFR"],
  [/\bvost\b/i, "VOST"],
  [/\bmulti\b/i, "MULTI"],
  [/\b(?:dual|duo)\b/i, "DUAL"],
  [/\bfrench\b/i, "FRENCH"],
  [/\bvo\b/i, "VO"],
];

const CUT_PATTERNS: [RegExp, Cut][] = [
  [/\bextended(?:[\s._-]?cut)?\b/i, "EXTENDED"],
  [/\btheatrical\b/i, "THEATRICAL"],
  [/\b(?:directors?[\s._-]?cut|\bdc\b)\b/i, "DIRECTORS-CUT"],
  [/\bunrated\b/i, "UNRATED"],
  [/\bimax\b/i, "IMAX"],
  [/\bfinal[\s._-]?cut\b/i, "FINAL-CUT"],
  [/\bremastered\b/i, "REMASTERED"],
  [/\bopen[\s._-]?matte\b/i, "OPEN-MATTE"],
  [/\bredux\b/i, "REDUX"],
  [/\bultimate(?:[\s._-]?edition)?\b/i, "ULTIMATE"],
];

const TAG_PATTERNS: [RegExp, QualityTag][] = [
  [/\breal[\s._-]?proper\b/i, "REAL-PROPER"],
  [/\brepack\b/i, "REPACK"],
  [/\bproper\b/i, "PROPER"],
  [/\brerip\b/i, "RERIP"],
  [/\bfixed\b/i, "FIXED"],
  [/\binternal\b/i, "INTERNAL"],
  [/\breadnfo\b/i, "READNFO"],
  [/\blimited\b/i, "LIMITED"],
  [/\bcomplete\b/i, "COMPLETE"],
];

const PROVIDER_PATTERNS: [RegExp, Provider][] = [
  [/\bamzn\b|\bamazon\b/i, "AMZN"],
  [/\bnf\b|\bnetflix\b/i, "NF"],
  [/\bdsnp\b|\bdisney\+?\b/i, "DSNP"],
  [/\bhmax\b|\bmax\b/i, "HMAX"],
  [/\batvp\b|\bappletv\+?\b/i, "ATVP"],
  [/\bitunes\b|\b\bit\b/i, "iT"],
  [/\bhulu\b/i, "HULU"],
  [/\bstan\b/i, "STAN"],
  [/\bpcok\b|\bpeacock\b/i, "PCOK"],
];

const TITLE_YEAR = /^(?<title>.+?)[. _-](?<year>(?:19|20)\d{2})\b/i;
// Multi-episode capture: S01E01-E02, S01E01.E02, S01E01E02
const SEASON_EP =
  /\bS(?<s>\d{1,2})E(?<e>\d{1,3})(?:[-.]?E?(?<e2>\d{1,3}))?\b|\bSeason[\s._-]?(?<s2>\d{1,2})\b|\bSaison[\s._-]?(?<s3>\d{1,2})\b/i;
// Date-style daily shows: 2026.04.24 or 2026-04-24
const AIR_DATE = /\b(?<y>20\d{2})[.\-](?<m>\d{2})[.\-](?<d>\d{2})\b/;
// Absolute episode (anime): 4-digit number after the title with no SxxExx
const ABSOLUTE_EP = /\b(?<abs>\d{3,4})\b(?!.*S\d{2}E\d{2})/i;
// Season pack indicators
const SEASON_PACK =
  /\b(?:complete|saison\.?\d+|season\.?\d+|integrale|intégrale|s\d{2}\b(?!.*e\d{2}))/i;
// PROPER level (REAL.PROPER > PROPER, REPACK2 > REPACK)
const PROPER_LEVEL = /\b(?:REAL\.?PROPER|PROPER|REPACK)(\d)?\b/i;
const SCENE_GROUP = /-(?<group>[A-Za-z0-9_]+)$/;
const BIT_DEPTH = /\b(?:10[\s._-]?bit|hi10p|main10)\b/i;

export function parseRelease(rawTitle: string, extras: { sizeBytes?: number; seeders?: number; durationMin?: number } = {}): ParsedRelease {
  const t = norm(rawTitle);
  const properMatch = PROPER_LEVEL.exec(rawTitle);
  const properLevel = properMatch
    ? /REAL/i.test(properMatch[0])
      ? 2
      : Number(properMatch[1] ?? 1) || 1
    : 0;
  const out: ParsedRelease = {
    raw: rawTitle,
    bitDepth: BIT_DEPTH.test(rawTitle) ? "10bit" : has(rawTitle, /\b8[\s._-]?bit\b/i) ? "8bit" : "unknown",
    languages: [],
    cuts: [],
    qualityTags: [],
    hasAtmos: has(rawTitle, /\batmos\b/i),
    isSeasonPack:
      SEASON_PACK.test(rawTitle) && !/\bS\d{2}E\d{2}\b/i.test(rawTitle),
    isCompleteSeason: has(rawTitle, /\bcomplete\b/i) && has(rawTitle, /\b(?:season|saison)\b/i),
    properLevel,
    hardcodedSubs: has(rawTitle, /\b(?:hardcoded|hardsub|\bhc\b)\b/i),
    penalties: [],
    sizeBytes: extras.sizeBytes,
    seeders: extras.seeders,
    durationMin: extras.durationMin,
  };

  const titleMatch = TITLE_YEAR.exec(t);
  if (titleMatch?.groups) {
    out.title = titleMatch.groups.title!.replace(/\./g, " ").trim();
    out.year = Number(titleMatch.groups.year);
  }

  for (const [re, val] of RES_PATTERNS) if (re.test(rawTitle)) { out.resolution = val; break; }
  for (const [re, val] of SOURCE_PATTERNS) if (re.test(rawTitle)) { out.source = val; break; }
  for (const [re, val] of CODEC_PATTERNS) if (re.test(rawTitle)) { out.codec = val; break; }
  for (const [re, val] of HDR_PATTERNS) if (re.test(rawTitle)) { out.hdr = val; break; }
  for (const [re, val] of AUDIO_PATTERNS) if (re.test(rawTitle)) { out.audioCodec = val; break; }
  for (const [re, val] of CHANNELS_PATTERNS) if (re.test(rawTitle)) { out.audioChannels = val; break; }
  for (const [re, val] of PROVIDER_PATTERNS) if (re.test(rawTitle)) { out.provider = val; break; }
  if (!out.hdr) out.hdr = "SDR";

  for (const [re, val] of LANG_PATTERNS) if (re.test(rawTitle) && !out.languages.includes(val)) out.languages.push(val);
  for (const [re, val] of CUT_PATTERNS) if (re.test(rawTitle) && !out.cuts.includes(val)) out.cuts.push(val);
  for (const [re, val] of TAG_PATTERNS) if (re.test(rawTitle) && !out.qualityTags.includes(val)) out.qualityTags.push(val);

  const sm = SEASON_EP.exec(rawTitle);
  if (sm?.groups) {
    const s = Number(sm.groups.s ?? sm.groups.s2 ?? sm.groups.s3);
    if (s) out.season = s;
    if (sm.groups.e) out.episode = Number(sm.groups.e);
    if (sm.groups.e2) out.episodeEnd = Number(sm.groups.e2);
  }
  // Daily shows: prefer date over season/episode if no SxxExx
  if (!out.episode) {
    const am = AIR_DATE.exec(rawTitle);
    if (am?.groups) out.airDate = `${am.groups.y}-${am.groups.m}-${am.groups.d}`;
  }
  // Anime absolute numbering — only flag if no SxxExx and no date
  if (!out.episode && !out.airDate) {
    const ab = ABSOLUTE_EP.exec(rawTitle);
    if (ab?.groups?.abs) out.absoluteEpisode = Number(ab.groups.abs);
  }

  const gm = SCENE_GROUP.exec(rawTitle);
  if (gm?.groups?.group) out.group = gm.groups.group.toUpperCase();

  // Penalties: heuristic flags
  if (has(rawTitle, /\b(?:lite|light|mini)\b/i) && !has(rawTitle, /\blimited\b/i))
    out.penalties.push("LITE");
  if (out.hardcodedSubs) out.penalties.push("HARDCODED");
  if (out.group === "YIFY" || out.group === "YTS") out.penalties.push("YIFY");
  if (out.group === "RARBG" && (out.year ?? 9999) > 2023) out.penalties.push("RARBG-FAKE");
  // Tiny 1080p (under 8MB/min suggests garbage re-encode)
  if (out.resolution === "1080p" && extras.sizeBytes && extras.durationMin) {
    const mbPerMin = extras.sizeBytes / 1e6 / extras.durationMin;
    if (mbPerMin < 8) out.penalties.push("TINY-1080P");
  }
  if (out.resolution === "2160p" && extras.sizeBytes && extras.durationMin) {
    const mbPerMin = extras.sizeBytes / 1e6 / extras.durationMin;
    if (mbPerMin < 30) out.penalties.push("TINY-2160P");
  }

  return out;
}
