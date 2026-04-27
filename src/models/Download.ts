import { Schema, model, models, type InferSchemaType } from "mongoose";

const DownloadSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    mediaId: { type: Schema.Types.ObjectId, ref: "Media", required: true },
    indexer: String,
    title: String,
    magnet: String,
    infoHash: { type: String, index: true },
    qbHash: { type: String, index: true },
    quality: String,
    sizeBytes: Number,
    seeders: Number,
    state: {
      type: String,
      enum: ["queued", "downloading", "completed", "failed", "imported", "removed"],
      default: "queued",
    },
    progress: { type: Number, default: 0 },
    completedAt: Date,
    season: Number,
    episode: Number,
    importedPath: String,
    error: String,
  },
  { timestamps: true },
);

export type DownloadDoc = InferSchemaType<typeof DownloadSchema> & { _id: string };
export const Download = models.Download || model("Download", DownloadSchema);
