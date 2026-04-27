import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { getDetails } from "@/lib/tmdb";
import { grabBest } from "@/lib/grab";

export const runtime = "nodejs";

const AddSchema = z.object({
  type: z.enum(["movie", "tv"]),
  tmdbId: z.number().int().positive(),
  qualityProfile: z.string().optional(),
  /** When true (default), trigger an auto-grab right after adding. */
  autoGrab: z.boolean().default(true),
  /** Optional profile to use for the auto-grab. Falls back to user default. */
  profileId: z.string().optional(),
});

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const items = await Media.find({ userId }).sort({ updatedAt: -1 }).lean();
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const details = await getDetails(parsed.data.type, parsed.data.tmdbId);
  await connectMongo();

  const doc = await Media.findOneAndUpdate(
    { userId, type: parsed.data.type, tmdbId: parsed.data.tmdbId },
    {
      $setOnInsert: {
        userId,
        type: parsed.data.type,
        tmdbId: parsed.data.tmdbId,
      },
      $set: {
        title: details.title,
        originalTitle: details.originalTitle,
        originalLanguage: details.originalLanguage,
        altTitles: details.altTitles,
        year: details.year ? Number(details.year) : undefined,
        yearMin: details.yearMin,
        yearMax: details.yearMax,
        overview: details.overview,
        poster: details.poster,
        backdrop: details.backdrop,
        seasons: details.seasons,
        qualityProfile: parsed.data.qualityProfile ?? "1080p",
      },
    },
    { upsert: true, new: true },
  );

  if (!parsed.data.autoGrab) {
    return NextResponse.json({ media: doc, grabbed: false });
  }

  // Trigger auto-grab using the selected (or default) profile.
  // Failures don't fail the add — the item stays in library as "wanted"
  // and the user gets the error message in the response.
  const grab = await grabBest({
    userId,
    mediaId: doc._id.toString(),
    profileId: parsed.data.profileId,
  });

  return NextResponse.json({
    media: doc,
    grabbed: grab.ok,
    grab: grab.ok
      ? { profile: grab.profile, releaseTitle: grab.release?.title }
      : { profile: grab.profile, error: grab.error, profileChain: grab.profileChain },
  });
}
