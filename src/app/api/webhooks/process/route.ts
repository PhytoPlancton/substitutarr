import { NextResponse } from "next/server";
import { flushPending } from "@/lib/webhooks";
import { acquireCronLock, releaseCronLock } from "@/lib/cron-lock";
import { log } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

function authorize(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const got = new URL(req.url).searchParams.get("key") ?? req.headers.get("x-cron-secret");
  return got === expected;
}

/**
 * Cron-driven webhook delivery worker.
 * Pull up to 50 due deliveries, attempt each (HMAC-signed POST, 8s timeout).
 * Failed attempts get backed off; after 5 failures they dead-letter.
 */
export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const acquired = await acquireCronLock("webhooks", 5 * 60_000);
  if (!acquired) {
    log.warn("webhook flush skipped — lock held");
    return NextResponse.json({ ok: true, skipped: "lock held" });
  }
  try {
    const { delivered, failed } = await flushPending(undefined, 50);
    return NextResponse.json({ ok: true, delivered, failed });
  } finally {
    await releaseCronLock("webhooks");
  }
}

export async function POST(req: Request) {
  return GET(req);
}
