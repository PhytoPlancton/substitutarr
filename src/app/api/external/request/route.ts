import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveApiKey } from "@/lib/api-keys";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { getDetails } from "@/lib/tmdb";
import { grabBest } from "@/lib/grab";

export const runtime = "nodejs";

const Schema = z.object({
  type: z.enum(["movie", "tv"]),
  tmdbId: z.number().int().positive(),
  profileId: z.string().optional(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  /** If false, only adds to library without triggering grab. Default true. */
  autoGrab: z.boolean().default(true),
});

function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(\S+)$/i);
  return m?.[1] ?? req.headers.get("x-api-key");
}

export async function POST(req: Request) {
  const token = getBearer(req);
  if (!token) return NextResponse.json({ error: "missing API key" }, { status: 401 });
  const result = await resolveApiKey(token, "external:request");
  if (!result.ok) {
    const status = result.reason === "rate-limited" ? 429 : 401;
    return NextResponse.json({ error: result.message }, { status });
  }
  const userId = result.data.userId;

  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { type, tmdbId, profileId, season, episode, autoGrab } = parsed.data;

  await connectMongo();
  const details = await getDetails(type, tmdbId);
  const media = await Media.findOneAndUpdate(
    { userId, type, tmdbId },
    {
      $setOnInsert: { userId, type, tmdbId },
      $set: {
        title: details.title,
        year: details.year ? Number(details.year) : undefined,
        overview: details.overview,
        poster: details.poster,
        backdrop: details.backdrop,
        seasons: details.seasons,
      },
    },
    { upsert: true, new: true },
  );

  if (!autoGrab) {
    return NextResponse.json({ ok: true, mediaId: media._id.toString(), grabbed: false });
  }

  const grabResult = await grabBest({
    userId,
    mediaId: media._id.toString(),
    profileId,
    season,
    episode,
  });

  return NextResponse.json(
    { mediaId: media._id.toString(), ...grabResult, grabbed: grabResult.ok },
    { status: grabResult.ok ? 200 : 422 },
  );
}
