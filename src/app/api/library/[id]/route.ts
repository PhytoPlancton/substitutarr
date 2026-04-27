import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  const item = await Media.findOne({ _id: id, userId }).lean();
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  const allowed = ["monitored", "qualityProfile", "minSeeders", "status"];
  const $set: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) $set[k] = body[k];
  await connectMongo();
  const item = await Media.findOneAndUpdate({ _id: id, userId }, { $set }, { new: true }).lean();
  return NextResponse.json({ item });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  await Media.deleteOne({ _id: id, userId });
  return NextResponse.json({ ok: true });
}
