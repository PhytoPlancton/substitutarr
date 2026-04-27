import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { searchMulti } from "@/lib/tmdb";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const hits = await searchMulti(q);
  return NextResponse.json({ results: hits });
}
