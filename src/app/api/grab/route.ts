import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { grabBest, grabMagnet } from "@/lib/grab";

export const runtime = "nodejs";

const Schema = z.object({
  mediaId: z.string(),
  magnet: z.string().optional(),
  // Optional rich metadata passed from search results
  title: z.string().optional(),
  infoHash: z.string().optional(),
  indexer: z.string().optional(),
  quality: z.string().optional(),
  sizeBytes: z.number().optional(),
  seeders: z.number().optional(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { mediaId, magnet, season, episode, ...meta } = parsed.data;
  const result = magnet
    ? await grabMagnet({ userId, mediaId, magnet, season, episode, ...meta })
    : await grabBest({ userId, mediaId, season, episode });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
