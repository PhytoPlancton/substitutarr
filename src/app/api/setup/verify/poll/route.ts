import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { pollToken } from "@/lib/setup-tokens";

export const runtime = "nodejs";

/**
 * Frontend polls this every 1s while waiting for the script ping.
 * Returns:
 *   waiting → keep polling
 *   ok      → script pinged successfully, advance the wizard
 *   expired → token timed out (90s), let user retry
 *   unknown → token never existed (likely typo / wrong wizard tab)
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });
  return NextResponse.json(pollToken(token, userId));
}
