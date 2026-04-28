import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { authExternal } from "@/lib/external-auth";

export const runtime = "nodejs";

/**
 * Paginated list of media requests for the authenticated user.
 *
 * Query params:
 *  - type=movie|tv          filter by type
 *  - status=…               filter movies by global status
 *  - q=                     prefix-match on title (case-insensitive)
 *  - limit=20 (max 100)
 *  - cursor=<id>            opaque cursor (last _id from previous page)
 */
export async function GET(req: Request) {
  const a = await authExternal(req);
  if (!a.ok) return a.res;
  const userId = a.userId;

  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q");
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 20)));
  const cursor = url.searchParams.get("cursor");

  await connectMongo();
  const filter: Record<string, unknown> = { userId };
  if (type === "movie" || type === "tv") filter.type = type;
  if (status) filter.status = status;
  if (q) filter.title = { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (cursor) filter._id = { $lt: cursor };

  const items = await Media.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean<any[]>();
  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;

  return NextResponse.json({
    items: page.map((m) => ({
      id: m._id.toString(),
      type: m.type,
      tmdbId: m.tmdbId,
      title: m.title,
      year: m.year,
      poster: m.poster,
      status: m.status, // movie-level; for TV use detail endpoint for episode states
      monitored: m.monitored,
      addedAt: m.addedAt,
    })),
    nextCursor: hasMore ? page[page.length - 1]?._id?.toString() ?? null : null,
  });
}
