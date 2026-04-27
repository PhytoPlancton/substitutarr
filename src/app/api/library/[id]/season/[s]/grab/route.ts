import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { grabBest } from "@/lib/grab";

export const runtime = "nodejs";

/** Grab a season pack (or per-episode if `episode` query param). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; s: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, s } = await params;
  const url = new URL(req.url);
  const ep = Number(url.searchParams.get("episode")) || undefined;

  const result = await grabBest({
    userId,
    mediaId: id,
    season: Number(s),
    episode: ep,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 422 });
}
