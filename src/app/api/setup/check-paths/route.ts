import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";

export const runtime = "nodejs";

const Schema = z.object({
  moviesRoot: z.string().min(1),
  tvRoot: z.string().min(1),
});

function checkPath(p: string): { ok: boolean; reason?: string } {
  try {
    const stat = fs.statSync(p);
    if (!stat.isDirectory()) return { ok: false, reason: "not a directory" };
    // Probe write access by attempting to create + delete a marker file
    const probe = path.join(p, `.substitutarr-write-probe-${Date.now()}`);
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return { ok: true };
  } catch (e: any) {
    if (e.code === "ENOENT") return { ok: false, reason: "folder does not exist" };
    if (e.code === "EACCES" || e.code === "EPERM") return { ok: false, reason: "no write access" };
    return { ok: false, reason: e.message };
  }
}

/**
 * Validate the user's library paths and persist them on success.
 * Same-volume requirement is checked so hardlinks will work later.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const moviesRoot = parsed.data.moviesRoot.trim();
  const tvRoot = parsed.data.tvRoot.trim();

  const movies = checkPath(moviesRoot);
  const tv = checkPath(tvRoot);
  if (!movies.ok || !tv.ok) {
    return NextResponse.json(
      {
        ok: false,
        movies,
        tv,
      },
      { status: 400 },
    );
  }

  // Same-volume check (Windows uses drive letter, POSIX uses fs.statSync.dev)
  const moviesRootChar = path.parse(moviesRoot).root.toLowerCase();
  const tvRootChar = path.parse(tvRoot).root.toLowerCase();
  let sameVolume = true;
  let volumeDetail: string | undefined;
  if (moviesRootChar && tvRootChar && moviesRootChar !== tvRootChar) {
    sameVolume = false;
    volumeDetail = `Movies on ${moviesRootChar.toUpperCase()} but TV on ${tvRootChar.toUpperCase()}. Hardlinks require both on the same volume.`;
  }
  if (!sameVolume) {
    return NextResponse.json({ ok: false, volume: { ok: false, reason: volumeDetail } }, { status: 400 });
  }

  await connectMongo();
  await UserSettings.updateOne(
    { userId },
    { $set: { "libraryPaths.movies": moviesRoot, "libraryPaths.tv": tvRoot } },
    { upsert: true },
  );

  return NextResponse.json({ ok: true, moviesRoot, tvRoot });
}
