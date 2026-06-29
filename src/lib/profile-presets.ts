/**
 * Default profiles seeded for new users.
 * Tailored for a French audience pulling from c411-style trackers.
 */
export const PROFILE_PRESETS = [
  {
    name: "1080p VFF Balanced",
    description: "Balance qualité / taille pour usage quotidien · 1080p · français (VFF / VOF si film FR).",
    appliesTo: "both",
    isDefault: true,
    filters: {
      minResolution: "720p",
      maxResolution: "1080p",
      minSeeders: 5,
      minSizeMB: 1500,
      maxSizeMB: 25000,
      requireLanguages: ["VFF", "TRUEFRENCH", "VOF", "MULTI", "FRENCH", "VFI"],
    },
  },
  {
    name: "Référence 4K Atmos",
    description: "Best quality home cinema · 4K HDR · audio object-based · groupes top tier.",
    appliesTo: "movie",
    isDefault: false,
    filters: {
      minResolution: "1080p",
      maxResolution: "2160p",
      minSeeders: 3,
      minSizeMB: 15000,
      requireLanguages: ["VFF", "TRUEFRENCH", "VOF", "MULTI"],
    },
    weightOverrides: {
      resolution: { "2160p": 200, "1080p": 50, "720p": 0 },
      atmos: 50,
      hdr: { "DV-FEL": 80, "DV-MEL": 70, DV: 60, "HDR10+": 50, HDR10: 35, HLG: 5, SDR: -10 },
    },
  },
  {
    name: "Storage Saver 720p",
    description: "Optimise l'espace disque · 720p HEVC · pour le mobile et les vieux clients.",
    appliesTo: "both",
    isDefault: false,
    filters: {
      minResolution: "480p",
      maxResolution: "720p",
      minSeeders: 5,
      maxSizeMB: 4000,
      requireLanguages: ["VFF", "TRUEFRENCH", "VOF", "MULTI", "FRENCH"],
    },
    weightOverrides: {
      resolution: { "720p": 100, "1080p": 30, "2160p": 0, "480p": 50 },
      codec: { x265: 40, AV1: 35, x264: 5 },
    },
  },
  {
    name: "VOSTFR Cinéphile",
    description: "Films en VO sous-titrés français · qualité priorisée sur taille.",
    appliesTo: "movie",
    isDefault: false,
    filters: {
      minResolution: "1080p",
      minSeeders: 3,
      requireLanguages: ["VOSTFR", "VOST", "VO", "MULTI", "DUAL"],
    },
    weightOverrides: {
      language: { VOSTFR: 100, VOST: 80, VO: 70, MULTI: 60, DUAL: 70, VFF: 30, TRUEFRENCH: 30 },
    },
  },
  {
    name: "Quick & Dirty",
    description: "Priorité vitesse · maximum de seeders · qualité acceptable, pas premium.",
    appliesTo: "both",
    isDefault: false,
    filters: {
      minResolution: "720p",
      maxResolution: "1080p",
      minSeeders: 30,
      maxSizeMB: 5000,
      requireLanguages: ["VFF", "TRUEFRENCH", "VOF", "MULTI", "FRENCH"],
    },
    weightOverrides: {
      seedersBonus: 25,
    },
  },
  {
    // Safety-net profile used as the last hop in the fallback chain. Designed to
    // catch ANY working release rather than return zero. FrankeinStream's shadow
    // run found 2/46 failures where stricter profiles filtered everything out —
    // this profile should pick up those cases without compromising the higher-
    // tier defaults.
    name: "Fallback - Last Resort",
    description: "Filet de sécurité · accepte n'importe quelle release plutôt que d'échouer · pas de filtre langue ni résolution min.",
    appliesTo: "both",
    isDefault: false,
    filters: {
      minSeeders: 1,
      // No minResolution, no requireLanguages, no maxSizeMB — anything goes.
      // The scoring still ranks the best release first; this only opens the gate.
    },
  },
] as const;
