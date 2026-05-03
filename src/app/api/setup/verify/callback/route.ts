import { NextResponse, type NextRequest } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { markPinged } from "@/lib/setup-tokens";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const Schema = z.object({
  verifyToken: z.string().min(1),
  ts: z.string().optional(),
});

function verifySignature(raw: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const secret = process.env.POSTPROCESS_HMAC_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const got = header.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Endpoint pinged by post-dl.ps1 -TestMode. Verifies the HMAC signature using
 * the same secret as /api/post-process — so success here proves the user's
 * script holds the correct secret AND can reach substitutarr from the host
 * where qBit will eventually call it.
 *
 * This route is public (no Clerk auth) — it's HMAC-protected.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-substitutarr-signature");

  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: z.infer<typeof Schema>;
  try {
    body = Schema.parse(JSON.parse(raw));
  } catch (e: any) {
    return NextResponse.json({ error: "bad payload", detail: e.message }, { status: 400 });
  }

  const accepted = markPinged(body.verifyToken);
  if (!accepted) {
    log.warn("verify-hook callback: unknown or expired token", { token: body.verifyToken });
    return NextResponse.json({ error: "unknown or expired token" }, { status: 410 });
  }

  return NextResponse.json({ ok: true });
}
