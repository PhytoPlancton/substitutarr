import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Download } from "@/models/Download";
import { getUserQbit } from "@/lib/qbittorrent";
import { recordHealth } from "@/lib/connection-health";
import { mapQbState, bucketFromDbState } from "@/lib/qbit-state";

export const runtime = "nodejs";

const HIDE_COMPLETED_AFTER_MS = 24 * 60 * 60 * 1000; // 24h
const PURGE_COMPLETED_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7d

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const showCompleted = url.searchParams.get("showCompleted") === "1";

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

  const now = Date.now();

  const merged = ours.map((d) => {
    const t = d.qbHash ? live[d.qbHash.toLowerCase()] : undefined;
    const info = t ? mapQbState(t.state) : { bucket: bucketFromDbState(d.state), label: humanLabel(d.state), showProgress: false, warning: false };
    const isCompleted = info.bucket === "completed";
    return {
      _id: d._id,
      mediaId: d.mediaId,
      title: d.title,
      indexer: d.indexer,
      quality: d.quality,
      sizeBytes: t?.size ?? d.sizeBytes,
      qbHash: d.qbHash,
      season: d.season,
      episode: d.episode,
      bucket: info.bucket,
      label: info.label,
      warning: info.warning,
      showProgress: info.showProgress,
      progress: t?.progress ?? d.progress ?? 0,
      qbState: t?.state,
      dlspeed: t?.dlspeed,
      eta: t?.eta,
      addedAt: d.createdAt ?? d.snatchedAt,
      completedAt: d.completedAt,
      isCompletedRecent:
        isCompleted &&
        (!d.completedAt || now - new Date(d.completedAt).getTime() < HIDE_COMPLETED_AFTER_MS),
    };
  });

  // Mark newly-completed in DB so we can fade/auto-purge by time.
  const newlyCompletedHashes = merged
    .filter((m) => m.bucket === "completed" && !m.completedAt)
    .map((m) => m.qbHash)
    .filter(Boolean) as string[];
  if (newlyCompletedHashes.length) {
    await Download.updateMany(
      { userId, qbHash: { $in: newlyCompletedHashes }, completedAt: { $exists: false } },
      { $set: { completedAt: new Date(), state: "completed" } },
    );
  }

  // Auto-purge: anything completed > 7d ago is removed from the visible list.
  await Download.updateMany(
    {
      userId,
      state: { $in: ["completed", "imported"] },
      completedAt: { $lt: new Date(now - PURGE_COMPLETED_AFTER_MS) },
    },
    { $set: { state: "removed" } },
  );

  // Filter the response: hide items completed > 24h ago unless ?showCompleted=1.
  const filtered = merged.filter((m) => {
    if (m.bucket !== "completed") return true;
    if (showCompleted) return true;
    return m.isCompletedRecent;
  });

  // Counts per bucket — the UI uses these for headers + counters.
  const counts = {
    active: 0,
    queued: 0,
    completed: 0,
    failed: 0,
  };
  for (const m of merged) counts[m.bucket]++;

  return NextResponse.json({ items: filtered, counts });
}

function humanLabel(state?: string): string {
  switch (state) {
    case "downloading": return "Downloading";
    case "completed": return "Done";
    case "failed": return "Failed";
    case "queued": return "Queued";
    default: return state ?? "Pending";
  }
}
