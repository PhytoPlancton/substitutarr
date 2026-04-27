import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Download } from "@/models/Download";
import { getUserQbit } from "@/lib/qbittorrent";

export const runtime = "nodejs";

/** POST /api/downloads/[id]/action  body: { action: "pause" | "resume" } */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { action } = await req.json();
  if (!["pause", "resume"].includes(action))
    return NextResponse.json({ error: "invalid action" }, { status: 400 });

  await connectMongo();
  const d = await Download.findOne({ _id: id, userId });
  if (!d || !d.qbHash) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    const qbit = await getUserQbit(userId);
    if (action === "pause") await qbit.pause([d.qbHash]);
    else await qbit.resume([d.qbHash]);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
