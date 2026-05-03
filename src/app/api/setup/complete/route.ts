import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";

export const runtime = "nodejs";

/** Marks the wizard as completed. Idempotent — re-completing keeps the
 *  original timestamp so we don't lose the "first-run" date. */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  await UserSettings.updateOne(
    { userId },
    { $setOnInsert: { setupCompletedAt: new Date() } },
    { upsert: true },
  );
  // If the field was missing entirely (existing users), set it now.
  await UserSettings.updateOne(
    { userId, setupCompletedAt: { $in: [null, undefined] } } as any,
    { $set: { setupCompletedAt: new Date() } },
  );
  return NextResponse.json({ ok: true });
}

/** Resets the wizard — useful when the HMAC rotates or paths change. */
export async function DELETE() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  await UserSettings.updateOne({ userId }, { $set: { setupCompletedAt: null } });
  return NextResponse.json({ ok: true });
}
