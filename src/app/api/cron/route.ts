import { NextResponse } from "next/server";
import { sweep } from "@/lib/sweep";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Authorize cron triggers from:
 *  - external schedulers carrying the CRON_SECRET (header or ?key=)
 *  - requests originating from localhost (127.0.0.1 / ::1) — safe because
 *    only processes already on the same machine can hit this. This is the
 *    "user clicks Refresh in the browser tab" path.
 *
 * Without this, self-hosted users have to fish the CRON_SECRET out of
 * .env.local to trigger a manual sweep — Radarr/Sonarr don't gate the
 * equivalent endpoints either.
 */
function authorize(req: Request): boolean {
  const expected = process.env.CRON_SECRET;
  const got = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-secret");
  if (expected && got === expected) return true;

  // Localhost bypass — substitutarr itself + the user's browser on the same box
  const host = req.headers.get("host") ?? "";
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const localHosts = ["127.0.0.1", "localhost", "::1", "[::1]"];
  if (localHosts.some((h) => host.startsWith(h)) && !xff) return true;
  return false;
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const acquired = await acquireCronLock("reconcile", 15 * 60_000);
  if (!acquired) {
    log.warn("cron reconcile skipped - another run holds the lock");
    return NextResponse.json({ ok: true, skipped: "lock held" });
  }
  try {
    const result = await sweep();
    return NextResponse.json({ ok: true, ...result });
  } finally {
    await releaseCronLock("reconcile");
  }
}

export async function POST(req: Request) {
  return GET(req);
}
