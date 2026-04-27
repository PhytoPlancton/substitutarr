import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Download } from "@/models/Download";

export const runtime = "nodejs";

/** Soft-purge all completed/imported downloads from the visible list.
 *  Does NOT touch qBit (the torrent stays seeding) — only hides from arrstack UI. */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const r = await Download.updateMany(
    { userId, state: { $in: ["completed", "imported"] } },
    { $set: { state: "removed" } },
  );
  return NextResponse.json({ ok: true, modified: r.modifiedCount });
}
