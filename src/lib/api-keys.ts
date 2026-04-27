import crypto from "node:crypto";
import { connectMongo } from "./mongo";
import { UserSettings } from "@/models/UserSettings";

export type ApiKeyMeta = {
  name: string;
  keyPreview: string;
  scopes: string[];
  expiresAt?: Date;
  createdAt: Date;
  lastUsedAt?: Date;
  usageCount?: number;
};

const PREFIX = "ars_";
const DEFAULT_TTL_DAYS = 90;
const RATE_LIMIT_PER_MINUTE = 60;

function hashKey(plain: string): string {
  // HMAC-SHA256 with a server-side pepper makes a DB dump useless without
  // also leaking the pepper. Falls back to plain SHA256 in dev (no pepper set).
  const pepper = process.env.API_KEY_PEPPER;
  if (pepper) return crypto.createHmac("sha256", pepper).update(plain).digest("hex");
  return crypto.createHash("sha256").update(plain).digest("hex");
}

export function generateKey(): string {
  return PREFIX + crypto.randomBytes(24).toString("base64url");
}

export async function createApiKey(
  userId: string,
  name: string,
  opts: { scopes?: string[]; ttlDays?: number } = {},
): Promise<{ plain: string; meta: ApiKeyMeta }> {
  await connectMongo();
  const plain = generateKey();
  const keyHash = hashKey(plain);
  const keyPreview = plain.slice(0, 12) + "…";
  const ttlDays = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 86400_000) : undefined;
  const scopes = opts.scopes ?? ["external:request"];
  const entry = { name, keyHash, keyPreview, scopes, expiresAt, createdAt: new Date() };
  await UserSettings.updateOne(
    { userId },
    { $push: { apiKeys: entry }, $setOnInsert: { userId } },
    { upsert: true },
  );
  return {
    plain,
    meta: { name, keyPreview, scopes, expiresAt, createdAt: entry.createdAt },
  };
}

export async function listApiKeys(userId: string): Promise<ApiKeyMeta[]> {
  await connectMongo();
  const s = await UserSettings.findOne({ userId }, { apiKeys: 1 }).lean<any>();
  return (s?.apiKeys ?? []).map((k: any) => ({
    name: k.name,
    keyPreview: k.keyPreview,
    scopes: k.scopes ?? ["external:request"],
    expiresAt: k.expiresAt,
    createdAt: k.createdAt,
    lastUsedAt: k.lastUsedAt,
    usageCount: k.usageCount ?? 0,
  }));
}

export async function deleteApiKey(userId: string, keyPreview: string): Promise<void> {
  await connectMongo();
  await UserSettings.updateOne({ userId }, { $pull: { apiKeys: { keyPreview } } });
}

export type ResolvedKey = {
  userId: string;
  scopes: string[];
};

export type ResolveError = "missing" | "invalid" | "expired" | "rate-limited" | "scope";

/**
 * Resolve an incoming Bearer token. Validates expiration, scope, and applies
 * a sliding 1-minute rate limit. Side-effects: updates lastUsedAt + counters.
 */
export async function resolveApiKey(
  token: string,
  requiredScope: string,
): Promise<{ ok: true; data: ResolvedKey } | { ok: false; reason: ResolveError; message: string }> {
  if (!token || !token.startsWith(PREFIX)) return { ok: false, reason: "missing", message: "missing or malformed key" };
  await connectMongo();
  const keyHash = hashKey(token);
  const s = await UserSettings.findOne({ "apiKeys.keyHash": keyHash }).lean<any>();
  if (!s?.userId) return { ok: false, reason: "invalid", message: "key not recognized" };
  const entry = (s.apiKeys ?? []).find((k: any) => k.keyHash === keyHash);
  if (!entry) return { ok: false, reason: "invalid", message: "key not recognized" };

  if (entry.expiresAt && new Date(entry.expiresAt) < new Date())
    return { ok: false, reason: "expired", message: "key expired — rotate it" };

  const scopes: string[] = entry.scopes ?? ["external:request"];
  if (!scopes.includes(requiredScope))
    return { ok: false, reason: "scope", message: `key missing scope ${requiredScope}` };

  // Sliding rate limit: 60 req / 60s per key
  const now = new Date();
  const windowStart = entry.rateWindowStart ? new Date(entry.rateWindowStart) : null;
  const inWindow = windowStart && now.getTime() - windowStart.getTime() < 60_000;
  const newCount = inWindow ? (entry.rateWindowCount ?? 0) + 1 : 1;
  if (newCount > RATE_LIMIT_PER_MINUTE)
    return { ok: false, reason: "rate-limited", message: "rate limit: 60 req/min" };

  await UserSettings.updateOne(
    { userId: s.userId, "apiKeys.keyHash": keyHash },
    {
      $set: {
        "apiKeys.$.lastUsedAt": now,
        "apiKeys.$.rateWindowStart": inWindow ? entry.rateWindowStart : now,
        "apiKeys.$.rateWindowCount": newCount,
      },
      $inc: { "apiKeys.$.usageCount": 1 },
    },
  );

  return { ok: true, data: { userId: s.userId, scopes } };
}
