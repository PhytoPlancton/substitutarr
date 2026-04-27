import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Download } from "@/models/Download";
import { getUserQbit } from "@/lib/qbittorrent";
import { recordHealth } from "@/lib/connection-health";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const ours = await Download.find({ userId, state: { $ne: "removed" } })
    .sort({ createdAt: -1 })
    .lean<any[]>();

  let live: Record<string, any> = {};
  try {
    const qbit = await getUserQbit(userId);
    const hashes = ours.map((d) => d.qbHash).filter(Boolean) as string[];
    if (hashes.length) {
      const torrents = await qbit.list({ hashes });
      for (const t of torrents) live[t.hash.toLowerCase()] = t;
    } else {
      // No torrents to query but client construction worked — light ping.
      await qbit.ping();
    }
    void recordHealth({ userId, service: "qbit", ok: true, detail: "downloads view" });
  } catch (e: any) {
    void recordHealth({ userId, service: "qbit", ok: false, detail: e?.message ?? String(e) });
    /* swallow — UI still shows DB state */
  }

  const merged = ours.map((d) => {
    const t = d.qbHash ? live[d.qbHash.toLowerCase()] : undefined;
    return {
      ...d,
      progress: t?.progress ?? d.progress ?? 0,
      qbState: t?.state,
      dlspeed: t?.dlspeed,
      eta: t?.eta,
    };
  });

  return NextResponse.json({ items: merged });
}
