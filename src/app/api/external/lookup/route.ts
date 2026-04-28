import { NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { authExternal } from "@/lib/external-auth";

export const runtime = "nodejs";

const Schema = z.object({
  type: z.enum(["movie", "tv"]),
  tmdbId: z.coerce.number().int().positive(),
});

/**
 * Cheap "is this in my library yet?" probe — the streaming site calls this
 * before showing a "Request" button so it can render "Already in library" /
 * "Downloading…" instead.
 *
 * GET /api/external/lookup?type=movie&tmdbId=12345
 */
export async function GET(req: Request) {
  const a = await authExternal(req);
  if (!a.ok) return a.res;
  const userId = a.userId;

  const url = new URL(req.url);
  const parsed = Schema.safeParse({
    type: url.searchParams.get("type"),
    tmdbId: url.searchParams.get("tmdbId"),
  });
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await connectMongo();
  const media = await Media.findOne(
    { userId, type: parsed.data.type, tmdbId: parsed.data.tmdbId },
    { _id: 1, status: 1, title: 1, monitored: 1, seasons: 1, type: 1 },
  ).lean<any>();
  if (!media) return NextResponse.json({ exists: false });

  // Compute a single rolled-up status the site can act on.
  let rolled = media.status as string | undefined;
  if (media.type === "tv" && media.seasons?.length) {
    const allEps = media.seasons.flatMap((s: any) => s.episodes ?? []);
    const total = allEps.length;
    const downloaded = allEps.filter((e: any) => e.status === "downloaded").length;
    const downloading = allEps.filter((e: any) => e.status === "downloading" || e.status === "snatched").length;
    if (total > 0 && downloaded === total) rolled = "downloaded";
    else if (downloading > 0) rolled = "downloading";
    else if (downloaded > 0) rolled = "partial";
    else rolled = "wanted";
  }

  return NextResponse.json({
    exists: true,
    id: media._id.toString(),
    title: media.title,
    status: rolled,
    monitored: media.monitored,
  });
}
