import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { getDetails } from "@/lib/tmdb";

export const runtime = "nodejs";

/** Re-fetch TMDB metadata and refresh season/episode names + posters
 *  + episode air dates without clobbering user state (monitored, status,
 *  file, grab). Useful for items added before the schema upgrade or to
 *  pick up new seasons / renamed episodes. */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  await connectMongo();
  const doc = await Media.findOne({ _id: id, userId });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const details = await getDetails(doc.type, doc.tmdbId);

  // Series-level metadata refresh
  doc.title = details.title;
  doc.originalTitle = details.originalTitle;
  doc.altTitles = details.altTitles;
  doc.overview = details.overview;
  doc.poster = details.poster;
  doc.backdrop = details.backdrop;
  if (doc.type === "tv") {
    (doc as any).tmdbStatus = (details as any).tmdbStatus;
    (doc as any).nextAirDate = (details as any).nextAirDate;
  }
  doc.lastTmdbRefreshAt = new Date();

  // Merge seasons — update names/posters/episode names without losing state.
  if (doc.type === "tv" && details.seasons) {
    const existingByNum = new Map<number, any>();
    for (const s of doc.seasons ?? []) existingByNum.set(s.number, s);

    const merged = details.seasons.map((fresh: any) => {
      const old = existingByNum.get(fresh.number);
      const oldEpsByNum = new Map<number, any>();
      for (const e of old?.episodes ?? []) oldEpsByNum.set(e.number, e);

      const episodes = (fresh.episodes ?? []).map((freshEp: any) => {
        const oldEp = oldEpsByNum.get(freshEp.number);
        return {
          // Refreshed metadata
          number: freshEp.number,
          name: freshEp.name,
          overview: freshEp.overview,
          airDate: freshEp.airDate,
          runtime: freshEp.runtime,
          // Preserved user state — fall back to defaults for new episodes
          status: oldEp?.status ?? "wanted",
          monitored: oldEp?.monitored ?? true,
          file: oldEp?.file,
          grab: oldEp?.grab,
          cutoffNotMet: oldEp?.cutoffNotMet,
          lastSearchedAt: oldEp?.lastSearchedAt,
        };
      });

      return {
        number: fresh.number,
        name: fresh.name,
        posterUrl: fresh.posterUrl,
        airDate: fresh.airDate,
        episodeCount: fresh.episodeCount,
        // Preserve season-level monitor toggle
        monitored: old?.monitored ?? true,
        episodes,
      };
    });

    doc.seasons = merged as any;
  }

  await doc.save();
  return NextResponse.json({ item: doc.toObject() });
}
