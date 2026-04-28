import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { BlockedRelease } from "@/models/BlockedRelease";
import { Media } from "@/models/Media";

export const runtime = "nodejs";

/** Global view of all blocked releases for the current user — settings page. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const items = await BlockedRelease.find({ userId }).sort({ blockedAt: -1 }).lean<any[]>();
  // Hydrate media titles in one round-trip
  const mediaIds = items.map((i) => i.mediaId).filter(Boolean);
  const medias = mediaIds.length
    ? await Media.find({ _id: { $in: mediaIds } }, { title: 1, type: 1 }).lean<any[]>()
    : [];
  const titleById = new Map(medias.map((m) => [m._id.toString(), { title: m.title, type: m.type }]));
  return NextResponse.json({
    items: items.map((b) => ({
      infoHash: b.infoHash,
      releaseTitle: b.releaseTitle,
      indexer: b.indexer,
      reason: b.reason,
      strikes: b.strikes,
      blockedAt: b.blockedAt,
      expiresAt: b.expiresAt,
      mediaId: b.mediaId?.toString(),
      mediaTitle: b.mediaId ? titleById.get(b.mediaId.toString())?.title : undefined,
      mediaType: b.mediaId ? titleById.get(b.mediaId.toString())?.type : undefined,
      season: b.season,
      episode: b.episode,
    })),
  });
}
