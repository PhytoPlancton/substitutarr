import { Schema, model, models, type InferSchemaType } from "mongoose";

const ProfileSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    description: String,
    appliesTo: { type: String, enum: ["movie", "tv", "both"], default: "both" },
    isDefault: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null, index: true },
    // If this profile finds no acceptable release, fall through to this other profile.
    // Cycle-protected at runtime; null/undefined = end of chain.
    fallbackProfileId: { type: String, default: null },

    // Hard filters — release excluded entirely if any check fails
    filters: {
      minResolution: { type: String, enum: ["SD", "480p", "720p", "1080p", "2160p"] },
      maxResolution: { type: String, enum: ["SD", "480p", "720p", "1080p", "2160p"] },
      minSeeders: { type: Number, default: 1 },
      minSizeMB: Number,
      maxSizeMB: Number,
      requireLanguages: [String], // audio — OR (at least one must match)
      blockedLanguages: [String],
      blockedSources: { type: [String], default: ["CAM", "HDCAM", "TS", "TC", "DVDSCR"] },
      // Advanced: arbitrary keywords (case-insensitive substrings).
      // Example: ['ENG.SUBS', 'MULTI.SUBS', 'VOSTANG'] for english subtitles required.
      requireKeywords: [String], // OR — release title must contain at least one
      blockedKeywords: [String], // any match → exclude
      requireHDR: { type: Boolean, default: false },
      blockHardcoded: { type: Boolean, default: true },
    },

    // Scoring weights — each dimension contributes to total score
    weights: {
      resolution: {
        "2160p": { type: Number, default: 100 },
        "1080p": { type: Number, default: 70 },
        "720p": { type: Number, default: 30 },
        "480p": { type: Number, default: 10 },
      },
      source: {
        REMUX: { type: Number, default: 80 },
        BLURAY: { type: Number, default: 60 },
        "WEB-DL": { type: Number, default: 50 },
        WEBRIP: { type: Number, default: 35 },
        BDRIP: { type: Number, default: 30 },
        BRRIP: { type: Number, default: 20 },
        HDTV: { type: Number, default: 10 },
        DVDRIP: { type: Number, default: 5 },
        HDRIP: { type: Number, default: 0 },
      },
      codec: {
        AV1: { type: Number, default: 25 },
        x265: { type: Number, default: 20 },
        x264: { type: Number, default: 15 },
        VP9: { type: Number, default: 5 },
        XVID: { type: Number, default: -20 },
      },
      bitDepth: {
        "10bit": { type: Number, default: 10 },
        "8bit": { type: Number, default: 0 },
      },
      hdr: {
        "DV-FEL": { type: Number, default: 40 },
        "DV-MEL": { type: Number, default: 35 },
        DV: { type: Number, default: 30 },
        "HDR10+": { type: Number, default: 25 },
        HDR10: { type: Number, default: 20 },
        HLG: { type: Number, default: 5 },
        SDR: { type: Number, default: 0 },
      },
      audioCodec: {
        TRUEHD: { type: Number, default: 35 },
        "DTS-X": { type: Number, default: 35 },
        "DTS-HD-MA": { type: Number, default: 30 },
        "DTS-HD-HRA": { type: Number, default: 20 },
        DTS: { type: Number, default: 15 },
        EAC3: { type: Number, default: 12 },
        AC3: { type: Number, default: 8 },
        AAC: { type: Number, default: 4 },
        FLAC: { type: Number, default: 25 },
        OPUS: { type: Number, default: 10 },
        MP3: { type: Number, default: 0 },
      },
      audioChannels: {
        "9.1.6": { type: Number, default: 20 },
        "7.1.4": { type: Number, default: 18 },
        "7.1": { type: Number, default: 15 },
        "5.1": { type: Number, default: 10 },
        "2.1": { type: Number, default: 3 },
        "2.0": { type: Number, default: 0 },
      },
      atmos: { type: Number, default: 15 },
      language: {
        VFF: { type: Number, default: 100 },
        TRUEFRENCH: { type: Number, default: 100 },
        VFI: { type: Number, default: 70 },
        MULTI: { type: Number, default: 60 },
        FRENCH: { type: Number, default: 55 },
        VF2: { type: Number, default: 40 },
        VFQ: { type: Number, default: 30 },
        DUAL: { type: Number, default: 50 },
        VOSTFR: { type: Number, default: 40 },
        VOST: { type: Number, default: 30 },
        VO: { type: Number, default: 25 },
        VOF: { type: Number, default: 80 },
      },
      cut: {
        EXTENDED: { type: Number, default: 5 },
        "DIRECTORS-CUT": { type: Number, default: 5 },
        IMAX: { type: Number, default: 5 },
        "FINAL-CUT": { type: Number, default: 5 },
        REMASTERED: { type: Number, default: 3 },
        ULTIMATE: { type: Number, default: 5 },
        REDUX: { type: Number, default: 3 },
        "OPEN-MATTE": { type: Number, default: 0 },
        UNRATED: { type: Number, default: 2 },
        THEATRICAL: { type: Number, default: 0 },
      },
      tag: {
        "REAL-PROPER": { type: Number, default: 8 },
        PROPER: { type: Number, default: 5 },
        REPACK: { type: Number, default: 5 },
        RERIP: { type: Number, default: 4 },
        FIXED: { type: Number, default: 3 },
        INTERNAL: { type: Number, default: 2 },
        COMPLETE: { type: Number, default: 5 },
        LIMITED: { type: Number, default: 0 },
        READNFO: { type: Number, default: 0 },
      },
      penalty: {
        CAM: { type: Number, default: -1000 },
        TS: { type: Number, default: -800 },
        HDCAM: { type: Number, default: -800 },
        TC: { type: Number, default: -600 },
        DVDSCR: { type: Number, default: -200 },
        YIFY: { type: Number, default: -200 },
        "RARBG-FAKE": { type: Number, default: -300 },
        LITE: { type: Number, default: -150 },
        HARDCODED: { type: Number, default: -100 },
        "TINY-1080P": { type: Number, default: -150 },
        "TINY-2160P": { type: Number, default: -150 },
      },
      // Multiplied by log2(seeders + 1)
      seedersBonus: { type: Number, default: 5 },
    },

    preferredGroupsTier1: {
      type: [String],
      default: [
        "HYPERION",
        "FRATERNiTY",
        "AOC",
        "FW",
        "MELBA",
        "FraMeSToR",
        "EbP",
        "BHDStudio",
        "HONE",
        "DON",
        "CtrlHD",
        "NTb",
        "FLUX",
        "playWEB",
        "KOGi",
        "CMRG",
      ],
    },
    preferredGroupsTier2: {
      type: [String],
      default: ["Slay3R", "KAF", "BAWLS", "EXTREME", "QxR", "SuccessfulCrab"],
    },
    blockedGroups: { type: [String], default: ["YIFY", "YTS"] },
    groupTier1Bonus: { type: Number, default: 50 },
    groupTier2Bonus: { type: Number, default: 25 },
  },
  { timestamps: true },
);

ProfileSchema.index({ userId: 1, name: 1 }, { unique: true });
// Structurally enforce one default per user — race-safe alternative to
// updateMany+findOneAndUpdate. Mongo refuses a 2nd doc with isDefault=true.
ProfileSchema.index(
  { userId: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

export type ProfileDoc = InferSchemaType<typeof ProfileSchema> & { _id: string };
export const Profile = models.Profile || model("Profile", ProfileSchema);
