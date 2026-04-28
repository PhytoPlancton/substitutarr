import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { Download } from "@/models/Download";
import { Activity } from "@/models/Activity";
import { authExternal } from "@/lib/external-auth";

export const runtime = "nodejs";

/**
 * Detailed view of a single media request — used by the streaming site to
 * show "Downloading… 47% · 3 seeders" type status without polling /downloads.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authExternal(req);
  if (!a.ok) return a.res;
  const userId = a.userId;
  const { id } = await params;

  await connectMongo();
  const media = await Media.findOne({ _id: id, userId }).lean<any>();
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });

  const downloads = await Download.find({ userId, mediaId: media._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .lean<any[]>();
  const activity = await Activity.find({ userId, mediaId: media._id })
    .sort({ createdAt: -1 })
    .limit(10)
    .lean<any[]>();

  return NextResponse.json({
    item: {
      id: media._id.toString(),
      type: media.type,
      tmdbId: media.tmdbId,
      title: media.title,
      originalTitle: media.originalTitle,
      year: media.year,
      poster: media.poster,
      backdrop: media.backdrop,
      overview: media.overview,
      status: media.status,
      monitored: media.monitored,
      qualityProfile: media.qualityProfile,
      addedAt: media.addedAt,
      seasons:
        media.type === "tv"
          ? media.seasons?.map((s: any) => ({
              number: s.number,
              monitored: s.monitored,
              episodeCount: s.episodes?.length ?? 0,
              downloaded: s.episodes?.filter((e: any) => e.status === "downloaded").length ?? 0,
              episodes: s.episodes?.map((e: any) => ({
                number: e.number,
                name: e.name,
                airDate: e.airDate,
                status: e.status,
                hasFile: !!e.file?.path,
              })),
            }))
          : undefined,
    },
    downloads: downloads.map((d) => ({
      id: d._id.toString(),
      title: d.title,
      state: d.state,
      progress: d.progress,
      season: d.season,
      episode: d.episode,
      indexer: d.indexer,
      qbHash: d.qbHash,
      sizeBytes: d.sizeBytes,
      seeders: d.seeders,
      createdAt: d.createdAt,
      completedAt: d.completedAt,
    })),
    activity: activity.map((a) => ({
      kind: a.kind,
      title: a.title,
      detail: a.detail,
      season: a.season,
      episode: a.episode,
      indexer: a.indexer,
      at: a.createdAt,
    })),
  });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await authExternal(req);
  if (!a.ok) return a.res;
  const userId = a.userId;
  const { id } = await params;

  await connectMongo();
  const result = await Media.deleteOne({ _id: id, userId });
  if (result.deletedCount === 0)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  // Soft-cleanup: leave Downloads and Activity in place for audit purposes.
  return NextResponse.json({ ok: true });
}
