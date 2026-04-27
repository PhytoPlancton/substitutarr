import { Schema, model, models, type InferSchemaType } from "mongoose";

const SeasonSchema = new Schema(
  {
    number: { type: Number, required: true },
    episodes: [
      {
        number: Number,
        name: String,
        airDate: String,
        haveFile: { type: Boolean, default: false },
        downloadId: String,
      },
    ],
  },
  { _id: false },
);

const MediaSchema = new Schema(
  {
    userId: { type: String, required: true, index: true },
    type: { type: String, enum: ["movie", "tv"], required: true },
    tmdbId: { type: Number, required: true },
    title: { type: String, required: true },
    /** Producers' native-language title. Used for indexer search since
     *  trackers index in original language (Le Dîner de cons, not "The Dinner Game"). */
    originalTitle: String,
    originalLanguage: String,
    /** Alternate FR/US/GB titles — useful for anime/foreign films where
     *  original_title is in non-Latin script. */
    altTitles: { type: [String], default: [] },
    year: Number,
    yearMin: Number,
    yearMax: Number,
    overview: String,
    poster: String,
    backdrop: String,
    status: {
      type: String,
      enum: ["wanted", "downloading", "downloaded", "missing", "paused"],
      default: "wanted",
    },
    monitored: { type: Boolean, default: true },
    qualityProfile: { type: String, default: "1080p" },
    minSeeders: { type: Number, default: 5 },
    seasons: [SeasonSchema],
    addedAt: { type: Date, default: Date.now },
    lastSearchedAt: Date,
  },
  { timestamps: true },
);

MediaSchema.index({ userId: 1, type: 1, tmdbId: 1 }, { unique: true });

export type MediaDoc = InferSchemaType<typeof MediaSchema> & { _id: string };
export const Media = models.Media || model("Media", MediaSchema);
