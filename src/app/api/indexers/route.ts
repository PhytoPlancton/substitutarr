import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { connectMongo } from "@/lib/mongo";
import { Indexer } from "@/models/Indexer";
import { assertSafeUrl } from "@/lib/ssrf-guard";

export const runtime = "nodejs";

const Schema = z.object({
  name: z.string().min(1),
  kind: z.enum(["yts", "eztv", "torznab", "rss"]),
  url: z.string().url().optional(),
  apiKey: z.string().optional(),
  categories: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const items = await Indexer.find({ userId }).sort({ priority: -1 }).lean();
  return NextResponse.json({ items });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  if (parsed.data.url) {
    try {
      await assertSafeUrl(parsed.data.url);
    } catch (e: any) {
      return NextResponse.json({ error: `unsafe URL: ${e.message}` }, { status: 400 });
    }
  }
  await connectMongo();
  const item = await Indexer.create({ ...parsed.data, userId });
  return NextResponse.json({ item });
}
