import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Download } from "@/models/Download";
import { getUserQbit } from "@/lib/qbittorrent";

export const runtime = "nodejs";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const url = new URL(req.url);
  const deleteFiles = url.searchParams.get("files") === "1";

  await connectMongo();
  const d = await Download.findOne({ _id: id, userId });
  if (!d) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (d.qbHash) {
    try {
      const qbit = await getUserQbit(userId);
      await qbit.delete([d.qbHash], deleteFiles);
    } catch {
      /* ignore */
    }
  }
  d.state = "removed";
  await d.save();
  return NextResponse.json({ ok: true });
}
