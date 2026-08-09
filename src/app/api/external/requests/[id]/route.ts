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
      quality: d.quality,
      sizeBytes: d.sizeBytes,
      seeders: d.seeders,
      /** Absolute path where the file was hardlinked in the library. Set once
       *  the import pipeline finishes; null while the torrent is still active
       *  or if the import step hasn't run yet. Callers can fs.access this to
       *  confirm Jellyfin will see the file. */
      importedPath: d.importedPath ?? null,
      createdAt: d.createdAt,
      completedAt: d.completedAt,
    })),
    /**
     * Rolled-up status for the external caller. Callers polling this endpoint
     * to detect "grab succeeded / failed" should read this before falling back
     * to individual download rows.
     *
     *   pending    - Media exists but no Download row yet (grab in flight, or async grab hasn't started)
     *   searching  - grab is running (no Download row within 60s of upsert)
     *   grabFailed - no Download row AND the last grabbed_failed Activity is recent
     *   downloading- at least one Download is downloading/queued
     *   downloaded - all expected downloads are completed AND have importedPath
     *   partial    - some downloads completed but not all (TV-only)
     */
    grab: rollupGrabState(media, downloads, activity),
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

function rollupGrabState(
  media: any,
  downloads: any[],
  activity: any[],
): { state: string; detail?: string; lastError?: string } {
  // Look for the most recent grab failure Activity — that's how we surface
  // "no releases passed any profile" style errors when there's no Download row.
  const lastFailed = activity.find((a) => a.kind === "grab_failed" || a.kind === "request.failed");

  if (downloads.length === 0) {
    // No Download row yet. Either grab is still searching, or it failed.
    if (lastFailed) {
      return { state: "grabFailed", detail: lastFailed.detail, lastError: lastFailed.detail };
    }
    const ageMs = media.addedAt ? Date.now() - new Date(media.addedAt).getTime() : Infinity;
    return ageMs < 60_000 ? { state: "searching" } : { state: "pending" };
  }

  const active = downloads.filter((d) => d.state === "downloading" || d.state === "queued");
  const completed = downloads.filter((d) => d.state === "completed");
  const withImport = completed.filter((d) => !!d.importedPath);

  if (active.length > 0) return { state: "downloading" };
  if (completed.length > 0 && withImport.length === completed.length) {
    return { state: "downloaded" };
  }
  if (completed.length > 0 && withImport.length > 0) {
    return { state: "partial", detail: `${withImport.length}/${completed.length} files imported` };
  }
  if (completed.length > 0) {
    return { state: "completedNoImport", detail: "torrent done but file not yet hardlinked into library" };
  }
  return { state: "pending" };
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
