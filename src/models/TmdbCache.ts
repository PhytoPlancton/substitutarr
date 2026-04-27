import { Schema, model, models } from "mongoose";

const TmdbCacheSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    payload: Schema.Types.Mixed,
    fetchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

// TTL: drop entries older than 24h. Mongo runs the background sweeper.
TmdbCacheSchema.index({ fetchedAt: 1 }, { expireAfterSeconds: 86400 });

export const TmdbCache = models.TmdbCache || model("TmdbCache", TmdbCacheSchema);
