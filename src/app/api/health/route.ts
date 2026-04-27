import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { getUserQbit } from "@/lib/qbittorrent";
import { getUserJellyfin } from "@/lib/jellyfin";
import mongoose from "mongoose";

export const runtime = "nodejs";

/** Light public health endpoint — just confirms the app is alive. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const deep = url.searchParams.get("deep") === "1";
  const token = url.searchParams.get("token") ?? req.headers.get("x-cron-secret");

  if (!deep) return NextResponse.json({ ok: true, mode: "shallow" });

  if (token !== process.env.CRON_SECRET)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const result: Record<string, any> = { ok: true, ts: new Date().toISOString() };

  try {
    await connectMongo();
    await mongoose.connection.db?.admin().ping();
    result.mongo = "ok";
  } catch (e: any) {
    result.mongo = `error: ${e.message}`;
    result.ok = false;
  }

  // qBit / Jellyfin checks use the dev-user's config in dev mode
  const probeUser = process.env.HEALTH_PROBE_USER || "dev-user";
  try {
    const qb = await getUserQbit(probeUser);
    const v = await qb.ping();
    result.qbit = `ok (${v.version})`;
  } catch (e: any) {
    result.qbit = `error: ${e.message}`;
  }
  try {
    const jf = await getUserJellyfin(probeUser);
    result.jellyfin = jf ? "configured" : "not configured";
  } catch (e: any) {
    result.jellyfin = `error: ${e.message}`;
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 503 });
}
