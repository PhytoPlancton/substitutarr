import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";

export const runtime = "nodejs";

const Schema = z.object({
  mediaId: z.string().min(1),
  /** Months to exclude. Omit for permanent exclusion. */
  months: z.number().int().positive().optional(),
});

/**
 * Exclude an item from retention. With `months`, sets a temporary exclusion
 * (typically called from the Discord "Keep this 6 months" link). Without,
 * the item is permanently excluded (set via the UI on a per-item basis).
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await connectMongo();
  const update: Record<string, unknown> = {};
  if (parsed.data.months) {
    update.retentionExcludedUntil = new Date(Date.now() + parsed.data.months * 30 * 86400_000);
    update.retentionPendingAt = null;
  } else {
    update.retentionExcluded = true;
    update.retentionPendingAt = null;
  }
  const r = await Media.updateOne({ _id: parsed.data.mediaId, userId }, { $set: update });
  if (r.matchedCount === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
