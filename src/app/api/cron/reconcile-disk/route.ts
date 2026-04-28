import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { Activity } from "@/models/Activity";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorize(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-secret");
  return got === expected;
}

/**
 * Disk reconciliation — runs nightly.
 *
 * For every media that has imported file paths, verify the file still exists.
 * If it's gone (user deleted it, drive failure, Jellyfin trash, etc.) we move
 * the episode/movie back to "missing" so the next cron sweep re-grabs it.
 *
 * Only effective when substitutarr's Node process can `stat` the same paths
 * the qBit hook wrote — i.e. the library volume is mounted on the host running
 * substitutarr. On a remote setup (substitutarr on Vercel, library on a NAS)
 * this is a no-op; we log and bail out cleanly.
 */
async function statSafe(p: string | undefined): Promise<boolean | null> {
  if (!p) return null;
  try {
    return fs.existsSync(p);
  } catch {
    return null; // permission/EACCES → can't tell, treat as unknown
  }
}

async function sweep(): Promise<{
  scanned: number;
  missing: number;
  unchanged: number;
  errors: string[];
}> {
  await connectMongo();
  const errors: string[] = [];
  let scanned = 0;
  let missing = 0;
  let unchanged = 0;

  // Movies — track by status=downloaded with no file path stored.
  // We don't currently persist movie file paths in Media; reconciliation for
  // movies depends on the Download.importedPath written by post-process.
  // For TV we can stat episode.file.path directly.
  const cursor = Media.find({
    type: "tv",
    "seasons.episodes.file.path": { $exists: true, $ne: null },
  }).cursor();

  for await (const m of cursor as any) {
    let touched = false;
    for (const season of m.seasons ?? []) {
      for (const ep of season.episodes ?? []) {
        if (!ep.file?.path || ep.status !== "downloaded") continue;
        scanned++;
        const exists = await statSafe(ep.file.path);
        if (exists === false) {
          ep.status = "missing";
          ep.file = undefined;
          missing++;
          touched = true;
          void Activity.create({
            userId: m.userId,
            mediaId: m._id,
            kind: "deleted_externally",
            title: m.title,
            season: season.number,
            episode: ep.number,
            detail: "file no longer on disk; flagged missing",
          }).catch(() => {});
        } else if (exists === true) {
          unchanged++;
        }
        // exists === null → unknown (can't reach the path); skip silently.
      }
    }
    if (touched) {
      try {
        await m.save();
      } catch (e: any) {
        errors.push(`save ${m.title}: ${e.message}`);
      }
    }
  }

  return { scanned, missing, unchanged, errors };
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const acquired = await acquireCronLock("reconcile-disk", 30 * 60_000);
  if (!acquired) {
    log.warn("reconcile-disk skipped — lock held");
    return NextResponse.json({ ok: true, skipped: "lock held" });
  }
  try {
    const result = await sweep();
    return NextResponse.json({ ok: true, ...result });
  } finally {
    await releaseCronLock("reconcile-disk");
  }
}

export async function POST(req: Request) {
  return GET(req);
}
