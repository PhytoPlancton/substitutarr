import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";

export const runtime = "nodejs";

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await connectMongo();
  const s = (await UserSettings.findOne({ userId }).lean()) as any;

  // Merge env-based fallbacks so the UI shows what's actually in use,
  // not just what's persisted. Server-side grab logic falls back to the
  // same env values, so the form should reflect that reality.
  const merge = (saved: any, env: Record<string, string | undefined>) => {
    const out: Record<string, string | undefined> = {};
    for (const [k, envVal] of Object.entries(env)) {
      out[k] = saved?.[k] || envVal || "";
    }
    return out;
  };

  const effective = {
    qbittorrent: {
      ...merge(s?.qbittorrent, {
        url: process.env.QBIT_URL,
        user: process.env.QBIT_USER,
        password: process.env.QBIT_PASSWORD,
      }),
      category: s?.qbittorrent?.category ?? "substitutarr",
    },
    jellyfin: {
      ...merge(s?.jellyfin, {
        url: process.env.JELLYFIN_URL,
        apiKey: process.env.JELLYFIN_API_KEY,
      }),
      autoRefresh: s?.jellyfin?.autoRefresh ?? true,
    },
    paths: s?.paths ?? { movies: "", tv: "", downloads: "" },
  };

  return NextResponse.json({ settings: s ?? null, effective });
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
