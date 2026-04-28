import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { OutboundWebhook } from "@/models/OutboundWebhook";

export const runtime = "nodejs";

const ALL_EVENTS = ["request.grabbed", "request.completed", "request.failed"];

const CreateSchema = z.object({
  name: z.string().min(1).max(60),
  url: z.string().url(),
  events: z.array(z.enum(["request.grabbed", "request.completed", "request.failed"])).optional(),
  active: z.boolean().optional(),
  radarrCompat: z.boolean().optional(),
});

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const items = await OutboundWebhook.find({ userId }).sort({ createdAt: -1 }).lean<any[]>();
  return NextResponse.json({
    items: items.map((w) => ({
      id: w._id.toString(),
      name: w.name,
      url: w.url,
      events: w.events,
      active: w.active,
      radarrCompat: w.radarrCompat,
      lastDeliveryAt: w.lastDeliveryAt,
      lastDeliveryStatus: w.lastDeliveryStatus,
      failureCount: w.failureCount,
      // Never expose secret in list view
      hasSecret: !!w.secret,
    })),
  });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = CreateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await connectMongo();
  const secret = "whs_" + crypto.randomBytes(32).toString("base64url");
  try {
    const doc = await OutboundWebhook.create({
      userId,
      name: parsed.data.name,
      url: parsed.data.url,
      secret,
      events: parsed.data.events ?? ALL_EVENTS,
      active: parsed.data.active ?? true,
      radarrCompat: parsed.data.radarrCompat ?? false,
    });
    // Return the secret ONCE so the user can paste it into the receiver.
    return NextResponse.json({
      id: doc._id.toString(),
      secret,
      hint: "Save this secret — you won't see it again. Use it to verify the X-Substitutarr-Signature header.",
    });
  } catch (e: any) {
    if (e.code === 11000) return NextResponse.json({ error: "name already used" }, { status: 409 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
