import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { connectMongo } from "@/lib/mongo";
import { Media } from "@/models/Media";
import { initialEpisodeStatus } from "@/lib/tv-monitoring";

export const runtime = "nodejs";

/** Toggle monitor on a whole season + cascade to its episodes. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; s: string }> },
) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id, s } = await params;
  const seasonNum = Number(s);
  const body = await req.json();
  const monitored = Boolean(body?.monitored);

  await connectMongo();
  const doc = await Media.findOne({ _id: id, userId });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const season = doc.seasons?.find((x: any) => x.number === seasonNum);
  if (!season) return NextResponse.json({ error: "season not found" }, { status: 404 });

  season.monitored = monitored;
  for (const ep of season.episodes ?? []) {
    // Don't touch episodes that are downloaded or in-flight — only their monitor flag.
    if (ep.status === "downloaded" || ep.status === "downloading" || ep.status === "snatched") {
      ep.monitored = monitored;
      continue;
    }
    if (monitored) {
      ep.monitored = true;
      ep.status = initialEpisodeStatus(ep.airDate ?? undefined);
    } else {
      ep.monitored = false;
      ep.status = "unmonitored";
    }
  }
  await doc.save();
  return NextResponse.json({ item: doc.toObject() });
}
