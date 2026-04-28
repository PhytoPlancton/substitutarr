import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import crypto from "node:crypto";
import { connectMongo } from "@/lib/mongo";
import { Download } from "@/models/Download";
import { Media } from "@/models/Media";
import { Activity } from "@/models/Activity";
import { getUserJellyfin } from "@/lib/jellyfin";
import { emit as emitWebhook } from "@/lib/webhooks";
import { log } from "@/lib/logger";

export const runtime = "nodejs";

const FileEntry = z.object({
  src: z.string().min(1),
  dst: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  isMain: z.boolean(),
});

const Payload = z.object({
  qbHash: z.string().regex(/^[a-fA-F0-9]{40}$/),
  contentPath: z.string().min(1),
  category: z.string().min(1),
  torrentName: z.string().min(1),
  files: z.array(FileEntry).min(1),
});

function verifySignature(raw: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const secret = process.env.POSTPROCESS_HMAC_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const got = header.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(got, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

const EP_RE = /S(\d{1,2})E(\d{1,3})(?:-?E?(\d{1,3}))?/i;

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-substitutarr-signature");

  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: z.infer<typeof Payload>;
  try {
    body = Payload.parse(JSON.parse(raw));
  } catch (e: any) {
    return NextResponse.json({ error: "bad payload", detail: e.message }, { status: 400 });
  }

  await connectMongo();

  const qbHash = body.qbHash.toLowerCase();
  const main = body.files.find((f) => f.isMain) ?? body.files[0];

  // Find the Download record we created at grab time. It carries userId + mediaId.
  const dl = await Download.findOne({ qbHash }).lean<any>();
  if (!dl) {
    log.warn("post-process: no Download for hash", { qbHash });
    return NextResponse.json({ ok: true, ignored: "no matching download" });
  }
  const userId: string = dl.userId;
  const mediaId = dl.mediaId;

  // Update the Download row
  await Download.updateOne(
    { _id: dl._id },
    {
      $set: {
        state: "completed",
        progress: 1,
        completedAt: new Date(),
        importedPath: main.dst,
      },
    },
  );

  // Update the Media — for movies, set status downloaded ; for TV, mark the
  // matching episode(s) as downloaded based on the dst SxxExx parse.
  const media = await Media.findOne({ _id: mediaId, userId });
  if (!media) {
    log.warn("post-process: media not found", { mediaId });
  } else if (media.type === "movie") {
    media.status = "downloaded";
    await media.save();
  } else if (media.type === "tv") {
    let touched = 0;
    for (const f of body.files) {
      const m = EP_RE.exec(f.dst.split(/[\\/]/).pop() ?? "");
      if (!m) continue;
      const sNum = Number(m[1]);
      const eStart = Number(m[2]);
      const eEnd = m[3] ? Number(m[3]) : eStart;
      const season = media.seasons?.find((s: any) => s.number === sNum);
      if (!season) continue;
      for (let n = eStart; n <= eEnd; n++) {
        const ep = season.episodes?.find((e: any) => e.number === n);
        if (!ep) continue;
        ep.status = "downloaded";
        ep.file = {
          path: f.dst,
          sizeBytes: f.sizeBytes,
          importedAt: new Date(),
        };
        touched++;
      }
    }
    if (touched > 0) await media.save();
    log.info(`post-process: tv updated ${touched} episode(s)`, { mediaId: String(mediaId) });
  }

  // Activity log
  await Activity.create({
    userId,
    mediaId,
    kind: "imported",
    title: body.torrentName,
    detail: `${body.files.length} file(s) hardlinked → library`,
  }).catch(() => {});

  // Jellyfin scan (fire-and-forget, optional)
  void (async () => {
    try {
      const jf = await getUserJellyfin(userId);
      if (jf) await jf.refreshAll();
    } catch (e: any) {
      log.warn("post-process: jellyfin refresh failed", { message: e.message });
    }
  })();

  // Outbound notify — Discord + user-configured webhooks
  if (media) {
    const epList: { season: number; episode: number }[] = [];
    if (media.type === "tv") {
      for (const f of body.files) {
        const m = EP_RE.exec(f.dst.split(/[\\/]/).pop() ?? "");
        if (!m) continue;
        const s = Number(m[1]);
        const eStart = Number(m[2]);
        const eEnd = m[3] ? Number(m[3]) : eStart;
        for (let n = eStart; n <= eEnd; n++) epList.push({ season: s, episode: n });
      }
    }
    void emitWebhook(userId, "request.completed", {
      type: media.type,
      mediaId: String(mediaId),
      tmdbId: media.tmdbId,
      title: media.title,
      year: media.year,
      poster: media.poster,
      episodes: epList.length ? epList : undefined,
      release: {
        title: body.torrentName,
      },
      download: {
        qbHash,
        importedPath: main.dst,
        fileCount: body.files.length,
      },
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    qbHash,
    linkedFiles: body.files.length,
    mediaId: mediaId ? String(mediaId) : null,
  });
}
