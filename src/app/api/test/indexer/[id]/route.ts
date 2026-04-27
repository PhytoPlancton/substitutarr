import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Indexer } from "@/models/Indexer";
import { recordHealth } from "@/lib/connection-health";
import { TorznabIndexer } from "@/lib/indexers/torznab";
import { YtsIndexer } from "@/lib/indexers/yts";
import { EztvIndexer } from "@/lib/indexers/eztv";

export const runtime = "nodejs";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  await connectMongo();
  const doc = await Indexer.findOne({ _id: id, userId }).lean<any>();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const start = Date.now();
  try {
    let releases = 0;
    if (doc.kind === "torznab") {
      if (!doc.url || !doc.apiKey) throw new Error("URL and API key required");
      const idx = new TorznabIndexer(doc.name, doc.url, doc.apiKey, doc.categories);
      // Lightweight probe: search a known popular term
      const r = await idx.search({ type: "movie", title: "Dune", year: 2021 });
      releases = r.length;
    } else if (doc.kind === "yts") {
      const idx = new YtsIndexer(doc.url || undefined);
      const r = await idx.search({ type: "movie", title: "Dune" });
      releases = r.length;
    } else if (doc.kind === "eztv") {
      const idx = new EztvIndexer(doc.url || undefined);
      const r = await idx.search({ type: "tv", title: "Game of Thrones", imdbId: "tt0944947" });
      releases = r.length;
    }
    const latencyMs = Date.now() - start;
    const detail = `${releases} sample releases · ${latencyMs}ms`;
    await recordHealth({ userId, service: `indexer:${id}`, ok: true, latencyMs, detail });
    return NextResponse.json({ ok: true, title: `${doc.name} responding`, detail, latencyMs });
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    const detail = e.message ?? String(e);
    await recordHealth({ userId, service: `indexer:${id}`, ok: false, latencyMs, detail });
    return NextResponse.json({ ok: false, title: `${doc.name} failed`, detail });
  }
}
