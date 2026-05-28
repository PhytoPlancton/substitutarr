import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { restoreFromRetention } from "@/lib/retention";

export const runtime = "nodejs";

const Schema = z.object({ mediaId: z.string().min(1) });

/**
 * Restore an item that was retention-deleted — flips monitored=true so the
 * next cron sweep re-grabs the same content. No bytes restored, just intent.
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const r = await restoreFromRetention(userId, parsed.data.mediaId);
  if (!r.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
