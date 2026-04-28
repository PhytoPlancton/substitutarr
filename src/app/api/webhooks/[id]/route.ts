import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { OutboundWebhook, WebhookDelivery } from "@/models/OutboundWebhook";

export const runtime = "nodejs";

const UpdateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  url: z.string().url().optional(),
  events: z.array(z.enum(["request.grabbed", "request.completed", "request.failed"])).optional(),
  active: z.boolean().optional(),
  radarrCompat: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = UpdateSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  await connectMongo();
  const doc = await OutboundWebhook.findOneAndUpdate(
    { _id: id, userId },
    { $set: parsed.data },
    { new: true },
  ).lean<any>();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  await OutboundWebhook.deleteOne({ _id: id, userId });
  // Cancel any pending deliveries — they would otherwise dead-letter on next attempt.
  await WebhookDelivery.updateMany(
    { webhookId: id, deliveredAt: null, deadLetterAt: null },
    { $set: { deadLetterAt: new Date(), lastError: "webhook deleted" } },
  );
  return NextResponse.json({ ok: true });
}
