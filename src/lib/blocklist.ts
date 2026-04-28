import { connectMongo } from "./mongo";
import { BlockedRelease } from "@/models/BlockedRelease";

const STRIKE_BLOCK_TTL_HOURS = 24;
const STRIKE_THRESHOLD = 3;

export async function isBlocked(userId: string, infoHash?: string): Promise<boolean> {
  if (!infoHash) return false;
  await connectMongo();
  const hash = infoHash.toLowerCase();
  const doc = await BlockedRelease.findOne({ userId, infoHash: hash }).lean<any>();
  if (!doc) return false;
  if (doc.expiresAt && new Date(doc.expiresAt) < new Date()) return false;
  return true;
}

/** Filter releases removing anything currently blocked for this user. */
export async function filterBlocked<T extends { infoHash?: string }>(
  userId: string,
  releases: T[],
): Promise<T[]> {
  if (releases.length === 0) return releases;
  await connectMongo();
  const hashes = releases.map((r) => r.infoHash?.toLowerCase()).filter(Boolean) as string[];
  if (hashes.length === 0) return releases;
  const blocked = await BlockedRelease.find({
    userId,
    infoHash: { $in: hashes },
    $or: [{ expiresAt: { $gt: new Date() } }, { expiresAt: null }, { expiresAt: { $exists: false } }],
  })
    .select({ infoHash: 1 })
    .lean<{ infoHash: string }[]>();
  const blockedSet = new Set(blocked.map((b) => b.infoHash));
  return releases.filter((r) => !r.infoHash || !blockedSet.has(r.infoHash.toLowerCase()));
}

/** Add a strike. After STRIKE_THRESHOLD strikes, block for STRIKE_BLOCK_TTL_HOURS. */
export async function addStrike(opts: {
  userId: string;
  infoHash: string;
  releaseTitle?: string;
  indexer?: string;
  mediaId?: string;
  season?: number;
  episode?: number;
}): Promise<{ blocked: boolean; strikes: number }> {
  await connectMongo();
  const hash = opts.infoHash.toLowerCase();
  const doc = await BlockedRelease.findOneAndUpdate(
    { userId: opts.userId, infoHash: hash },
    {
      $inc: { strikes: 1 },
      $setOnInsert: {
        userId: opts.userId,
        infoHash: hash,
        releaseTitle: opts.releaseTitle,
        indexer: opts.indexer,
        mediaId: opts.mediaId,
        season: opts.season,
        episode: opts.episode,
        reason: "auto:repeated_fail",
        blockedAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
  if (doc.strikes >= STRIKE_THRESHOLD && !doc.expiresAt) {
    doc.expiresAt = new Date(Date.now() + STRIKE_BLOCK_TTL_HOURS * 3600_000);
    await doc.save();
    return { blocked: true, strikes: doc.strikes };
  }
  return { blocked: !!doc.expiresAt, strikes: doc.strikes };
}

/** Block manually (no expiration unless `ttlHours` provided). */
export async function blockManually(opts: {
  userId: string;
  infoHash: string;
  releaseTitle?: string;
  indexer?: string;
  mediaId?: string;
  season?: number;
  episode?: number;
  reason?: string;
  ttlHours?: number;
}): Promise<void> {
  await connectMongo();
  const hash = opts.infoHash.toLowerCase();
  const expiresAt = opts.ttlHours
    ? new Date(Date.now() + opts.ttlHours * 3600_000)
    : null;
  await BlockedRelease.updateOne(
    { userId: opts.userId, infoHash: hash },
    {
      $set: {
        userId: opts.userId,
        infoHash: hash,
        releaseTitle: opts.releaseTitle,
        indexer: opts.indexer,
        mediaId: opts.mediaId,
        season: opts.season,
        episode: opts.episode,
        reason: opts.reason ?? "manual",
        blockedAt: new Date(),
        expiresAt,
      },
    },
    { upsert: true },
  );
}

export async function unblock(userId: string, infoHash: string): Promise<void> {
  await connectMongo();
  await BlockedRelease.deleteOne({ userId, infoHash: infoHash.toLowerCase() });
}
