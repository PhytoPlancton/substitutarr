import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Profile } from "@/models/Profile";
import { authExternal } from "@/lib/external-auth";

export const runtime = "nodejs";

/**
 * List visible profiles for an external client (the streaming site uses this to
 * populate a dropdown when the user picks "request in 4K" / "request in 1080p" etc).
 */
export async function GET(req: Request) {
  const a = await authExternal(req);
  if (!a.ok) return a.res;
  const userId = a.userId;

  await connectMongo();
  const items = await Profile.find({ userId, deletedAt: null })
    .sort({ isDefault: -1, name: 1 })
    .lean<any[]>();

  return NextResponse.json({
    items: items.map((p) => ({
      id: p._id.toString(),
      name: p.name,
      description: p.description,
      appliesTo: p.appliesTo,
      isDefault: !!p.isDefault,
      fallbackProfileId: p.fallbackProfileId ?? null,
      // Just the headline filters — not the full scoring matrix.
      filters: {
        minResolution: p.filters?.minResolution,
        maxResolution: p.filters?.maxResolution,
        minSeeders: p.filters?.minSeeders,
        requireLanguages: p.filters?.requireLanguages,
        blockedLanguages: p.filters?.blockedLanguages,
      },
    })),
  });
}
