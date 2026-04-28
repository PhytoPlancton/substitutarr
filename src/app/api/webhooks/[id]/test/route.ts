import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { OutboundWebhook } from "@/models/OutboundWebhook";
import { testWebhook } from "@/lib/webhooks";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;

  await connectMongo();
  const w = await OutboundWebhook.findOne({ _id: id, userId }, { _id: 1 }).lean<any>();
  if (!w) return NextResponse.json({ error: "not found" }, { status: 404 });

  const r = await testWebhook(id);
  return NextResponse.json(r, { status: r.ok ? 200 : 502 });
}
