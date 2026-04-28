import { Schema, model, models, type InferSchemaType } from "mongoose";

/**
 * Releases that should NOT be re-grabbed for some time.
 * - Auto-blocked when grab fails repeatedly (3 strikes) for the same infoHash
 * - Manually blocked when user clicks "block this release" in Search & explain
 *
 * The cron sweep + grabBest both consult this collection before pushing to qBit.
 */
const BlockedReleaseSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    infoHash: { type: String, required: true },
    releaseTitle: String,
    indexer: String,
    /** "auto:repeated_fail" | "auto:qbit_rejected" | "manual" | "user:bad_quality" */
    reason: { type: String, default: "manual" },
    strikes: { type: Number, default: 1 },
    blockedAt: { type: Date, default: Date.now, index: true },
    /** When the block automatically expires. null = permanent until manually unblocked. */
    expiresAt: { type: Date, index: true },
    /** Optional media reference (so we can show "blocked for X" in detail page) */
    mediaId: { type: Schema.Types.ObjectId, ref: "Media" },
    season: Number,
    episode: Number,
  },
  { timestamps: true },
);

BlockedReleaseSchema.index({ userId: 1, infoHash: 1 }, { unique: true });
// TTL on expiresAt — Mongo auto-purges expired entries
BlockedReleaseSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type BlockedReleaseDoc = InferSchemaType<typeof BlockedReleaseSchema> & { _id: string };
export const BlockedRelease =
  models.BlockedRelease || model("BlockedRelease", BlockedReleaseSchema);
