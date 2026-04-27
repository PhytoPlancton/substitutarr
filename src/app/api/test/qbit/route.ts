import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { QBittorrent } from "@/lib/qbittorrent";
import { recordHealth } from "@/lib/connection-health";

export const runtime = "nodejs";

const Schema = z.object({
  url: z.string().url(),
  user: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, title: "Invalid input", detail: "URL, user and password are required." },
      { status: 200 },
    );
  }

  const start = Date.now();
  const qb = new QBittorrent(parsed.data);
  try {
    const v = await qb.ping();
    const latencyMs = Date.now() - start;
    await recordHealth({ userId, service: "qbit", ok: true, latencyMs, detail: `qBit ${v.version}` });
    return NextResponse.json({ ok: true, title: `qBittorrent ${v.version}`, latencyMs });
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    const detail = e.message ?? String(e);
    await recordHealth({ userId, service: "qbit", ok: false, latencyMs, detail });
    return NextResponse.json({ ok: false, title: "qBittorrent unreachable", detail });
  }
}
