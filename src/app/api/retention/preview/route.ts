import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { evaluateCandidates } from "@/lib/retention";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * On-demand dry-run preview — returns the candidates the cron would delete
 * right now (respecting all guards). Used by the Retention settings page to
 * show the user what's at stake before they flip Active.
 */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const result = await evaluateCandidates(userId);
  return NextResponse.json({
    jellyfinHealthy: result.jellyfinHealthy,
    diskPercent: result.diskPercent,
    diskPressureActive: result.diskPressureActive,
    skippedReason: result.skippedReason,
    totalBytes: result.totalBytes,
    candidates: result.candidates,
  });
}
