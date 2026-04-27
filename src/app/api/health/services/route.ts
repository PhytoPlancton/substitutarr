import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { ConnectionHealth } from "@/models/ConnectionHealth";

export const runtime = "nodejs";

/** Returns the current per-service health for the active user.
 *  Used by sidebar dots and page headers — read-only, no probing. */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const items = await ConnectionHealth.find({ userId })
    .select({ service: 1, status: 1, lastTestedAt: 1, detail: 1, latencyMs: 1 })
    .lean();
  const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
  // Apply staleness server-side
  const out: Record<string, any> = {};
  for (const h of items as any[]) {
    let status = h.status as "unknown" | "connected" | "error" | "stale";
    if (status === "connected" && h.lastTestedAt) {
      const age = Date.now() - new Date(h.lastTestedAt).getTime();
      if (age > STALE_AFTER_MS) status = "stale";
    }
    out[h.service] = {
      status,
      lastTestedAt: h.lastTestedAt,
      detail: h.detail,
      latencyMs: h.latencyMs,
    };
  }
  return NextResponse.json({ services: out });
}
