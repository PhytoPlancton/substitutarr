import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Profile } from "@/models/Profile";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  const item = await Profile.findOne({ _id: id, userId }).lean();
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ item });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json();
  await connectMongo();
  if (body.isDefault === true) {
    await Profile.updateMany({ userId, _id: { $ne: id } }, { $set: { isDefault: false } });
  }
  const item = await Profile.findOneAndUpdate({ _id: id, userId }, { $set: body }, { new: true }).lean();
  return NextResponse.json({ item });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  const target = await Profile.findOne({ _id: id, userId, deletedAt: null });
  if (!target) return NextResponse.json({ error: "not found" }, { status: 404 });
  // Soft-delete: in-flight grabs that captured this profile keep working from
  // the snapshot. The doc is hidden from /api/profiles list filters.
  // Also clear isDefault to free the partial-unique index.
  target.deletedAt = new Date();
  if (target.isDefault) target.isDefault = false;
  await target.save();
  // Promote a replacement default if needed
  const stillDefault = await Profile.findOne({ userId, isDefault: true, deletedAt: null });
  if (!stillDefault) {
    const fallback = await Profile.findOne({ userId, deletedAt: null }).sort({ name: 1 });
    if (fallback) {
      fallback.isDefault = true;
      await fallback.save();
    }
  }
  return NextResponse.json({ ok: true });
}
