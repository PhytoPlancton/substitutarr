import { Schema, model, models, type InferSchemaType } from "mongoose";

const ConnectionHealthSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    /** "qbit", "jellyfin", or "indexer:<indexerId>" */
    service: { type: String, required: true },
    status: {
      type: String,
      enum: ["unknown", "connected", "error", "stale"],
      default: "unknown",
    },
    detail: String,
    latencyMs: Number,
    lastTestedAt: Date,
    lastSuccessAt: Date,
  },
  { timestamps: true },
);

ConnectionHealthSchema.index({ userId: 1, service: 1 }, { unique: true });

export type ConnectionHealthDoc = InferSchemaType<typeof ConnectionHealthSchema> & { _id: string };
export const ConnectionHealth =
  models.ConnectionHealth || model("ConnectionHealth", ConnectionHealthSchema);
