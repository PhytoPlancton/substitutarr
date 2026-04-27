import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { Activity } from "@/models/Activity";
import { getExtras } from "@/lib/tmdb";

export const runtime = "nodejs";

/** Returns rich TMDB metadata + recent activity for the detail page.
 *  Cached server-side for 24h via the TMDB client cache + this route's revalidate. */
export const revalidate = 3600;

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  await connectMongo();
  const media = await Media.findOne({ _id: id, userId }).lean<any>();
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [extras, activity] = await Promise.all([
    getExtras(media.type, media.tmdbId).catch(() => null),
    Activity.find({ userId, mediaId: id }).sort({ at: -1 }).limit(20).lean(),
  ]);

  return NextResponse.json({ extras, activity });
}
