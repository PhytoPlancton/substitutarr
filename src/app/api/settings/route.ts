import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const s = await UserSettings.findOne({ userId }).lean();
  return NextResponse.json({ settings: s ?? null });
}

export async function PUT(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  await connectMongo();
  const s = await UserSettings.findOneAndUpdate(
    { userId },
    { $set: { ...body, userId } },
    { upsert: true, new: true },
  ).lean();
  return NextResponse.json({ settings: s });
}
