import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { searchAll } from "@/lib/indexers/registry";
import { Profile } from "@/models/Profile";
import { connectMongo } from "@/lib/mongo";
import { ensureProfilesForUser } from "@/lib/profile-bootstrap";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const mediaId = url.searchParams.get("mediaId") ?? undefined;
  let title = url.searchParams.get("title") ?? "";
  let type = (url.searchParams.get("type") ?? "movie") as "movie" | "tv";
  let year = Number(url.searchParams.get("year")) || undefined;
  let tmdbId: number | undefined;
  const season = Number(url.searchParams.get("season")) || undefined;
  const episode = Number(url.searchParams.get("episode")) || undefined;
  const profileId = url.searchParams.get("profileId") ?? undefined;

  await connectMongo();

  // Convenience: if mediaId is provided, hydrate title/type/year/tmdbId from DB.
  // Use originalTitle for the indexer query — trackers index in producers' native language.
  let altTitles: string[] = [];
  let yearMin: number | undefined;
  let yearMax: number | undefined;
  if (mediaId) {
    const { Media } = await import("@/models/Media");
    const m = await Media.findOne({ _id: mediaId, userId }).lean<any>();
    if (m) {
      title = m.originalTitle || m.title;
      altTitles = [m.title, ...(m.altTitles ?? [])].filter((x: string) => x && x !== title);
      type = m.type;
      year = m.year;
      yearMin = m.yearMin;
      yearMax = m.yearMax;
      tmdbId = m.tmdbId;
    }
  }

  await ensureProfilesForUser(userId);
  const profile = profileId
    ? await Profile.findOne({ _id: profileId, userId }).lean<any>()
    : await Profile.findOne({ userId, isDefault: true }).lean<any>();
  if (!profile) return NextResponse.json({ error: "no profile" }, { status: 400 });

  const result = await searchAll(
    userId,
    { type, title, altTitles, year, yearMin, yearMax, tmdbId, season, episode },
    profile,
  );
  return NextResponse.json({ ...result, profile: profile.name, profileId: profile._id });
}
