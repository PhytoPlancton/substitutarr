import { Schema, model, models, type InferSchemaType } from "mongoose";

const ActivitySchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    mediaId: { type: Schema.Types.ObjectId, ref: "Media", index: true },
    /** "grabbed" | "imported" | "upgraded" | "deleted" | "failed" | "removed" */
    kind: { type: String, required: true },
    title: String, // release title or human-readable summary
    detail: String, // optional extra text (error message, profile name…)
    season: Number,
    episode: Number,
    indexer: String,
    profile: String,
    at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false },
);

ActivitySchema.index({ userId: 1, mediaId: 1, at: -1 });

export type ActivityDoc = InferSchemaType<typeof ActivitySchema> & { _id: string };
export const Activity = models.Activity || model("Activity", ActivitySchema);
