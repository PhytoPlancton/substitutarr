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
