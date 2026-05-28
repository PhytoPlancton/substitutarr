import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Per-episode state machine — derived from real-world grab/import history.
 * unaired   : airDate > now, no file
 * wanted    : aired and monitored but no file yet
 * snatched  : sent to qBit (or download client), 0% progress
 * downloading
 * downloaded: file imported, optionally below cutoff
 * missing   : aired + monitored + no file after search exhausted
 * unmonitored: explicitly disabled by the user
 */
export type EpisodeStatus =
  | "unaired"
  | "wanted"
  | "snatched"
  | "downloading"
  | "downloaded"
  | "missing"
  | "unmonitored";

const EpisodeFileSchema = new Schema(
  {
    path: String,
    sizeBytes: Number,
    quality: String,
    qualityScore: Number,
    importedAt: Date,
    releaseGroup: String,
  },
  { _id: false },
);

const EpisodeGrabSchema = new Schema(
  {
    downloadId: String, // qBit hash (lowercase)
    indexer: String,
    releaseTitle: String,
    snatchedAt: Date,
  },
  { _id: false },
);

const EpisodeSchema = new Schema(
  {
    number: { type: Number, required: true },
    absoluteNumber: Number,
    name: String,
    overview: String,
    airDate: String, // YYYY-MM-DD; string keeps timezone irrelevant
    runtime: Number,
    status: {
      type: String,
      enum: ["unaired", "wanted", "snatched", "downloading", "downloaded", "missing", "unmonitored"],
      default: "wanted",
    },
    monitored: { type: Boolean, default: true },
    file: EpisodeFileSchema,
    grab: EpisodeGrabSchema,
    /** True when downloaded but file.qualityScore < profile cutoff. */
    cutoffNotMet: { type: Boolean, default: false },
    lastSearchedAt: Date,
  },
  { _id: false },
);

const SeasonSchema = new Schema(
  {
    number: { type: Number, required: true },
    name: String,
    posterUrl: String,
    airDate: String,
    episodeCount: Number,
    monitored: { type: Boolean, default: true },
    episodes: [EpisodeSchema],
  },
  { _id: false },
);

/**
 * Strategy applied at add-time and when new seasons are detected from TMDB.
 * One-shot transformation — does NOT continuously override user toggles.
 */
export type MonitoringStrategy =
  | "all"          // monitor everything that exists
  | "future"       // unmonitor existing, monitor only airDate > now
  | "missing"      // monitor everything aired without a file
  | "existing"     // monitor only episodes with a file already
  | "firstSeason"  // S01 only
  | "lastSeason"   // most recent season only
  | "pilot"        // S01E01 only
  | "recent"       // most recent season + future
  | "none";        // metadata only, manual ops

const MediaSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ["movie", "tv"], required: true },
    tmdbId: { type: Number, required: true },
    tvdbId: Number,
    imdbId: String,
    title: { type: String, required: true },
    originalTitle: String,
    originalLanguage: String,
    altTitles: { type: [String], default: [] },
    year: Number,
    yearMin: Number,
    yearMax: Number,
    overview: String,
    poster: String,
    backdrop: String,

    /** Movie-only: legacy global status. For TV, derived from episodes. */
    status: {
      type: String,
      enum: ["wanted", "downloading", "downloaded", "missing", "paused"],
      default: "wanted",
    },
    monitored: { type: Boolean, default: true },
    qualityProfile: { type: String, default: "1080p" },
    minSeeders: { type: Number, default: 5 },

    // TV-specific
    /** "returning" | "ended" | "canceled" | "in_production" | "planned" */
    tmdbStatus: String,
    /** "standard" | "absolute" | "daily" — drives the matching logic. */
    numbering: { type: String, default: "standard" },
    nextAirDate: String,
    monitoringStrategy: {
      type: String,
      enum: ["all", "future", "missing", "existing", "firstSeason", "lastSeason", "pilot", "recent", "none"],
      default: "all",
    },

    seasons: [SeasonSchema],

    addedAt: { type: Date, default: Date.now },
    lastSearchedAt: Date,
    lastTmdbRefreshAt: Date,

    // ---- Retention (auto-delete) ----
    /** User opted this item out of retention permanently. */
    retentionExcluded: { type: Boolean, default: false },
    /** Temporary exclusion (e.g. 6 months) after the user clicked "Keep this" in the Discord ping. */
    retentionExcludedUntil: { type: Date, default: null },
    /** A retention notice is scheduled — `pendingDeletionAt` is when the cron will actually delete. */
    retentionPendingAt: { type: Date, default: null },
    retentionPendingReason: String,
    /** Set when the cron deleted the file. Lets the user "restore" by flipping monitored back on. */
    retentionDeletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

MediaSchema.index({ userId: 1, type: 1, tmdbId: 1 }, { unique: true });

export type MediaDoc = InferSchemaType<typeof MediaSchema> & { _id: string };
export const Media = models.Media || model("Media", MediaSchema);
