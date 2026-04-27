import { Schema, model, models, type InferSchemaType } from "mongoose";

const IndexerSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    kind: {
      type: String,
      enum: ["yts", "eztv", "torznab", "rss"],
      required: true,
    },
    url: String,
    apiKey: String,
    categories: [String],
    enabled: { type: Boolean, default: true },
    priority: { type: Number, default: 50 },
    lastError: String,
    lastSuccessAt: Date,
  },
  { timestamps: true },
);

export type IndexerDoc = InferSchemaType<typeof IndexerSchema> & { _id: string };
export const Indexer = models.Indexer || model("Indexer", IndexerSchema);
