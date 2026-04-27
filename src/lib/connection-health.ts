import { connectMongo } from "./mongo";
import { ConnectionHealth } from "@/models/ConnectionHealth";

export type HealthStatus = "unknown" | "connected" | "error" | "stale";
const STALE_AFTER_MS = 24 * 60 * 60 * 1000; // 24h

export async function recordHealth(opts: {
  userId: string;
  service: string;
  ok: boolean;
  detail?: string;
  latencyMs?: number;
}): Promise<void> {
  await connectMongo();
  const now = new Date();
  const $set: Record<string, unknown> = {
    userId: opts.userId,
    service: opts.service,
    status: opts.ok ? "connected" : "error",
    detail: opts.detail,
    latencyMs: opts.latencyMs,
    lastTestedAt: now,
  };
  if (opts.ok) $set.lastSuccessAt = now;
  await ConnectionHealth.updateOne(
    { userId: opts.userId, service: opts.service },
    { $set },
    { upsert: true },
  );
}

/** Returns current health, downgrading "connected" → "stale" if it's old. */
export async function getHealth(
  userId: string,
  service: string,
): Promise<{ status: HealthStatus; lastTestedAt?: Date; detail?: string } | null> {
  await connectMongo();
  const doc = await ConnectionHealth.findOne({ userId, service }).lean<any>();
  if (!doc) return null;
  let status: HealthStatus = doc.status ?? "unknown";
  if (status === "connected" && doc.lastTestedAt) {
    const age = Date.now() - new Date(doc.lastTestedAt).getTime();
    if (age > STALE_AFTER_MS) status = "stale";
  }
  return { status, lastTestedAt: doc.lastTestedAt, detail: doc.detail };
}
