/**
 * In-memory verify-hook token store. Tokens are short-lived (60s) and only
 * persist across a single user's wizard interaction — no need to survive a
 * server restart, so a Map is fine.
 *
 * Each token tracks a `pinged` flag flipped to true once the post-dl.ps1 script
 * (called with -TestMode) hits /api/setup/verify/callback.
 */

type Entry = {
  userId: string;
  createdAt: number;
  pinged: boolean;
  pingedAt?: number;
};

const TTL_MS = 90_000;
const store = new Map<string, Entry>();

function gc() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - v.createdAt > TTL_MS) store.delete(k);
  }
}

export function createVerifyToken(userId: string): string {
  gc();
  const token = "vh_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  store.set(token, { userId, createdAt: Date.now(), pinged: false });
  return token;
}

export function markPinged(token: string): boolean {
  gc();
  const e = store.get(token);
  if (!e) return false;
  e.pinged = true;
  e.pingedAt = Date.now();
  return true;
}

export function pollToken(token: string, userId: string): {
  status: "waiting" | "ok" | "expired" | "unknown";
  pingedAt?: number;
} {
  gc();
  const e = store.get(token);
  if (!e) return { status: "unknown" };
  if (e.userId !== userId) return { status: "unknown" };
  if (Date.now() - e.createdAt > TTL_MS) return { status: "expired" };
  if (e.pinged) return { status: "ok", pingedAt: e.pingedAt };
  return { status: "waiting" };
}
