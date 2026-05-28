import { Schema, model, models, type InferSchemaType } from "mongoose";

const UserSettingsSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    qbittorrent: {
      url: String,
      user: String,
      password: String,
      category: { type: String, default: "substitutarr" },
    },
    jellyfin: {
      url: String,
      apiKey: String,
      autoRefresh: { type: Boolean, default: true },
    },
    paths: {
      // empty by default → substitutarr lets qBit use its own configured save_path
      // (avoids pushing Linux-style paths to a Windows qBit instance)
      movies: { type: String, default: "" },
      tv: { type: String, default: "" },
      downloads: { type: String, default: "" },
    },
    /**
     * Library paths — where the post-DL hook hardlinks files (Jellyfin sees them here).
     * Different from `paths` above: those are qBit save paths (download destination),
     * these are library paths (final hardlink destination).
     */
    libraryPaths: {
      movies: { type: String, default: "" },
      tv: { type: String, default: "" },
    },
    /** First-run wizard completion. Null = wizard never completed → redirect to /setup. */
    setupCompletedAt: { type: Date, default: null },

    /**
     * Auto-deletion / retention. Default mode is "off" — feature is fully opt-in.
     * Activation flow:
     *   off → dry_run (7-day cool-down) → active
     * The cron blocks direct off → active transitions on the backend.
     */
    retention: {
      mode: { type: String, enum: ["off", "dry_run", "active"], default: "off" },
      activatedAt: { type: Date, default: null },
      dryRunStartedAt: { type: Date, default: null },
      thresholds: {
        /** Days since `addedAt` with PlayCount === 0 → candidate. */
        notWatchedSinceImportDays: { type: Number, default: 90 },
        /** Days since `LastPlayedDate` with PlayCount >= 1 → candidate. */
        watchedLongAgoDays: { type: Number, default: 180 },
        /** Days since LastPlayedDate of the last episode of an "ended" TV show. */
        tvEndedBingedDays: { type: Number, default: 120 },
        /** Disk usage percentage on the library volume that triggers LRU sweep. */
        diskPressurePercent: { type: Number, default: 85 },
      },
      /** Hard cap on deletions per cron run — limit blast radius if anything goes wrong. */
      maxDeletionsPerDay: { type: Number, default: 10 },
      /** Lead time for the Discord pre-deletion ping (hours). */
      preDeleteNoticeHours: { type: Number, default: 24 },
      lastRunAt: { type: Date, default: null },
      lastRunSummary: {
        candidates: { type: Number, default: 0 },
        deleted: { type: Number, default: 0 },
        bytesFreed: { type: Number, default: 0 },
        skippedReason: String,
      },
    },
    quality: {
      preferred: { type: String, default: "1080p" },
      fallback: { type: String, default: "720p" },
      minSeeders: { type: Number, default: 5 },
    },
    notifications: {
      slackWebhook: String,
      /** Discord webhook URL — substitutarr fans grab/complete/failed events here. */
      discordWebhook: String,
      /** Which events to send to Discord. Defaults to completed + failed (most useful). */
      discordEvents: {
        type: [String],
        default: ["request.completed", "request.failed"],
      },
    },
    apiKeys: [
      {
        // Stored as HMAC-SHA256 hex (with API_KEY_PEPPER); plain key shown once.
        name: { type: String, required: true },
        keyHash: { type: String, required: true, index: true },
        keyPreview: String,
        scopes: { type: [String], default: ["external:request"] },
        expiresAt: Date,
        createdAt: { type: Date, default: Date.now },
        lastUsedAt: Date,
        usageCount: { type: Number, default: 0 },
        // Sliding window rate-limit counter (Mongo-only, no Redis):
        rateWindowStart: Date,
        rateWindowCount: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true },
);

export type UserSettingsDoc = InferSchemaType<typeof UserSettingsSchema> & { _id: string };
export const UserSettings = models.UserSettings || model("UserSettings", UserSettingsSchema);
