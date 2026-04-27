import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongo";
import { Profile } from "@/models/Profile";
import { ensureProfilesForUser } from "@/lib/profile-bootstrap";

export const runtime = "nodejs";

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  appliesTo: z.enum(["movie", "tv", "both"]).default("both"),
  isDefault: z.boolean().optional(),
  fallbackProfileId: z.string().nullable().optional(),
  filters: z.record(z.string(), z.any()).optional(),
  weights: z.record(z.string(), z.any()).optional(),
  preferredGroupsTier1: z.array(z.string()).optional(),
  preferredGroupsTier2: z.array(z.string()).optional(),
  blockedGroups: z.array(z.string()).optional(),
  groupTier1Bonus: z.number().optional(),
  groupTier2Bonus: z.number().optional(),
});

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  await ensureProfilesForUser(userId);
  const items = await Profile.find({ userId, deletedAt: null }).sort({ isDefault: -1, name: 1 }).lean();
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  await connectMongo();
  if (parsed.data.isDefault) {
    await Profile.updateMany({ userId, isDefault: true }, { $set: { isDefault: false } });
  }
  const item = await Profile.create({ userId, ...parsed.data });
  return NextResponse.json({ item });
}
