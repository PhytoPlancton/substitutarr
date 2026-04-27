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

  /** Map qBit live state to a coarse arrstack status the UI can render. */
  const mapState = (qb?: string): string | undefined => {
    if (!qb) return undefined;
    if (/^(uploading|stalledUP|forcedUP|pausedUP|stoppedUP|queuedUP|checkingUP)$/.test(qb))
      return "completed";
    if (/^(error|missingFiles)$/.test(qb)) return "failed";
    if (/^(pausedDL|stoppedDL)$/.test(qb)) return "paused";
    return "downloading";
  };

  const merged = ours.map((d) => {
    const t = d.qbHash ? live[d.qbHash.toLowerCase()] : undefined;
    const fromQb = mapState(t?.state);
    return {
      ...d,
      // Effective state — UI should prefer this over the persisted state, which
      // can be stale until the cron sweeps. Keep raw `state` for backward compat.
      state: fromQb ?? d.state,
      progress: t?.progress ?? d.progress ?? 0,
      qbState: t?.state,
      dlspeed: t?.dlspeed,
      eta: t?.eta,
      sizeBytes: t?.size ?? d.sizeBytes,
    };
  });

  return NextResponse.json({ items: merged });
}
