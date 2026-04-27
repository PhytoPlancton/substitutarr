import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Indexer } from "@/models/Indexer";
import { assertSafeUrl } from "@/lib/ssrf-guard";

export const runtime = "nodejs";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  if (typeof body.url === "string" && body.url) {
    try {
      await assertSafeUrl(body.url);
    } catch (e: any) {
      return NextResponse.json({ error: `unsafe URL: ${e.message}` }, { status: 400 });
    }
  }
  await connectMongo();
  const item = await Indexer.findOneAndUpdate({ _id: id, userId }, { $set: body }, { new: true }).lean();
  return NextResponse.json({ item });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  await Indexer.deleteOne({ _id: id, userId });
  return NextResponse.json({ ok: true });
}
