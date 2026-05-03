import { NextResponse } from "next/server";
import fs from "node:fs";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";
import { Indexer } from "@/models/Indexer";
import { getUserQbit } from "@/lib/qbittorrent";
import { getUserJellyfin } from "@/lib/jellyfin";

export const runtime = "nodejs";

type StepState = "ok" | "pending" | "error";

/**
 * Aggregates the wizard state — the frontend reads this once on mount and
 * after each step to know which steps are green, which are blockers, and
 * whether the wizard is fully complete.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectMongo();
  const s = (await UserSettings.findOne({ userId }).lean()) as any;

  // Step 2: library paths
  const moviesPath = s?.libraryPaths?.movies?.trim();
  const tvPath = s?.libraryPaths?.tv?.trim();
  let pathsState: StepState = "pending";
  let pathsDetail: string | undefined;
  if (moviesPath && tvPath) {
    try {
      const m = fs.statSync(moviesPath);
      const t = fs.statSync(tvPath);
      if (m.isDirectory() && t.isDirectory()) pathsState = "ok";
      else {
        pathsState = "error";
        pathsDetail = "configured paths exist but aren't directories";
      }
    } catch (e: any) {
      pathsState = "error";
      pathsDetail = e.message;
    }
  }

  // Step 3: qBittorrent reachable + 2 categories present
  let qbitState: StepState = "pending";
  let categoriesState: StepState = "pending";
  let qbitDetail: string | undefined;
  try {
    const qb = await getUserQbit(userId);
    await qb.ping();
    qbitState = "ok";
    const cats = await qb.listCategories();
    const hasMovies = !!cats["substitutarr-movies"];
    const hasTv = !!cats["substitutarr-tv"];
    categoriesState = hasMovies && hasTv ? "ok" : "pending";
  } catch (e: any) {
    qbitState = "error";
    qbitDetail = e.message;
  }

  // Step 4: indexers + library server (lighter checks — wizard treats them as ok if any indexer enabled)
  const indexerCount = await Indexer.countDocuments({ userId, enabled: true });
  const indexersState: StepState = indexerCount > 0 ? "ok" : "pending";

  let jellyfinState: StepState = "pending";
  try {
    const jf = await getUserJellyfin(userId);
    if (jf) {
      // We don't ping Jellyfin here — the dedicated test endpoint already does.
      // Just check if creds are saved.
      jellyfinState = "ok";
    }
  } catch {
    /* leave pending */
  }

  // Step 5: hook configured (proxied by setupCompletedAt — set at the end)
  const setupCompletedAt = s?.setupCompletedAt ?? null;
  const setupComplete = !!setupCompletedAt;

  return NextResponse.json({
    setupComplete,
    setupCompletedAt,
    steps: {
      paths: { state: pathsState, detail: pathsDetail, moviesRoot: moviesPath, tvRoot: tvPath },
      qbit: { state: qbitState, detail: qbitDetail },
      categories: { state: categoriesState },
      indexers: { state: indexersState, count: indexerCount },
      jellyfin: { state: jellyfinState, configured: jellyfinState === "ok" },
    },
  });
}
