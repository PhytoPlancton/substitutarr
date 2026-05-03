import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getUserQbit } from "@/lib/qbittorrent";

export const runtime = "nodejs";

/**
 * Idempotently create the two qBit categories substitutarr routes torrents into:
 *   - substitutarr-movies
 *   - substitutarr-tv
 * Both with empty savePath so qBit keeps using its own default download path
 * (avoids pushing Linux-style paths to a Windows qBit instance).
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const qb = await getUserQbit(userId);
    await qb.createCategory("substitutarr-movies", "");
    await qb.createCategory("substitutarr-tv", "");
    const cats = await qb.listCategories();
    return NextResponse.json({
      ok: true,
      created: ["substitutarr-movies", "substitutarr-tv"],
      categories: Object.keys(cats),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
