import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { BlockedRelease } from "@/models/BlockedRelease";
import { blockManually, unblock } from "@/lib/blocklist";

export const runtime = "nodejs";

const BlockSchema = z.object({
  infoHash: z.string().regex(/^[a-fA-F0-9]{40}$/),
  releaseTitle: z.string().optional(),
  indexer: z.string().optional(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  reason: z.string().optional(),
  /** TTL in hours; omit = permanent block until manually unblocked. */
  ttlHours: z.number().int().positive().optional(),
});

/** List blocked releases scoped to a media item (used in Search & explain "Blocked" tab). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  const media = await Media.findOne({ _id: id, userId }, { _id: 1 }).lean<any>();
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });
  const items = await BlockedRelease.find({ userId, mediaId: media._id })
    .sort({ blockedAt: -1 })
    .lean<any[]>();
  return NextResponse.json({
    items: items.map((b) => ({
      infoHash: b.infoHash,
      releaseTitle: b.releaseTitle,
      indexer: b.indexer,
      reason: b.reason,
      strikes: b.strikes,
      blockedAt: b.blockedAt,
      expiresAt: b.expiresAt,
      season: b.season,
      episode: b.episode,
    })),
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  const parsed = BlockSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await connectMongo();
  const media = await Media.findOne({ _id: id, userId }, { _id: 1 }).lean<any>();
  if (!media) return NextResponse.json({ error: "not found" }, { status: 404 });

  await blockManually({
    userId,
    infoHash: parsed.data.infoHash,
    releaseTitle: parsed.data.releaseTitle,
    indexer: parsed.data.indexer,
    mediaId: media._id.toString(),
    season: parsed.data.season,
    episode: parsed.data.episode,
    reason: parsed.data.reason ?? "manual",
    ttlHours: parsed.data.ttlHours,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await params; // mediaId not strictly needed — infoHash is globally unique per user
  const url = new URL(req.url);
  const infoHash = url.searchParams.get("infoHash");
  if (!infoHash || !/^[a-fA-F0-9]{40}$/.test(infoHash))
    return NextResponse.json({ error: "infoHash required (sha1 hex)" }, { status: 400 });
  await unblock(userId, infoHash);
  return NextResponse.json({ ok: true });
}
