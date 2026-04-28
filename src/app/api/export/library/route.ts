import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { Profile } from "@/models/Profile";

export const runtime = "nodejs";

/**
 * Library export — JSON dump suitable for re-import into another *arr instance
 * or for emergency rollback if substitutarr ever breaks. Plan B against lock-in.
 *
 * Schema is deliberately flat & versioned — future-compatible additions stay opt-in.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectMongo();
  const [media, profiles] = await Promise.all([
    Media.find({ userId }).lean<any[]>(),
    Profile.find({ userId, deletedAt: null }).lean<any[]>(),
  ]);

  const payload = {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    counts: {
      movies: media.filter((m) => m.type === "movie").length,
      tv: media.filter((m) => m.type === "tv").length,
      profiles: profiles.length,
    },
    profiles: profiles.map((p) => ({
      name: p.name,
      description: p.description,
      appliesTo: p.appliesTo,
      isDefault: !!p.isDefault,
      filters: p.filters,
      weights: p.weights,
      preferredGroupsTier1: p.preferredGroupsTier1,
      preferredGroupsTier2: p.preferredGroupsTier2,
      blockedGroups: p.blockedGroups,
    })),
    movies: media
      .filter((m) => m.type === "movie")
      .map((m) => ({
        tmdbId: m.tmdbId,
        title: m.title,
        year: m.year,
        monitored: m.monitored,
        qualityProfile: m.qualityProfile,
        status: m.status,
        addedAt: m.addedAt,
      })),
    series: media
      .filter((m) => m.type === "tv")
      .map((m) => ({
        tmdbId: m.tmdbId,
        tvdbId: m.tvdbId,
        imdbId: m.imdbId,
        title: m.title,
        year: m.year,
        monitored: m.monitored,
        qualityProfile: m.qualityProfile,
        monitoringStrategy: m.monitoringStrategy,
        addedAt: m.addedAt,
        seasons: (m.seasons ?? []).map((s: any) => ({
          number: s.number,
          monitored: s.monitored,
          episodes: (s.episodes ?? []).map((e: any) => ({
            number: e.number,
            status: e.status,
            monitored: e.monitored,
            // File path/sizing kept for reseed-on-cutover
            file: e.file?.path
              ? { path: e.file.path, sizeBytes: e.file.sizeBytes, importedAt: e.file.importedAt }
              : undefined,
          })),
        })),
      })),
  };

  // Stream the JSON with Content-Disposition so the browser saves it as a file
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="substitutarr-library-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
