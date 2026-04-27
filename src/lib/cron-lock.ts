import { Schema, model, models } from "mongoose";
import { connectMongo } from "./mongo";

const CronLockSchema = new Schema({
  name: { type: String, required: true, unique: true },
  heldUntil: { type: Date, required: true, index: true },
  holder: String,
});
const CronLock = models.CronLock || model("CronLock", CronLockSchema);

/**
 * Distributed lock to prevent overlapping cron runs (Vercel/GitHub Actions
 * may fire while a previous run is still going). Returns true if we acquired
 * the lock, false if someone else already holds it.
 */
export async function acquireCronLock(name: string, ttlMs = 15 * 60_000): Promise<boolean> {
  await connectMongo();
  const now = new Date();
  const heldUntil = new Date(now.getTime() + ttlMs);
  const holder = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await CronLock.findOneAndUpdate(
      { name, heldUntil: { $lt: now } },
      { $set: { name, heldUntil, holder } },
      { upsert: true, new: true },
    );
    // Re-read to confirm we own it (race-safe)
    const doc = await CronLock.findOne({ name }).lean<any>();
    return doc?.holder === holder;
  } catch (e: any) {
    // Duplicate key on upsert means someone else owns it
    if (e.code === 11000) return false;
    throw e;
  }
}

export async function releaseCronLock(name: string): Promise<void> {
  await connectMongo();
  await CronLock.updateOne({ name }, { $set: { heldUntil: new Date(0) } });
}
