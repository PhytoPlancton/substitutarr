/**
 * Cloudflare bypass helpers for Torznab indexers (C411 et al).
 *
 * FrankeinStream's shadow report logged 24/46 failures on C411 returning
 * 5xx / challenge HTML — Cloudflare anti-bot. This module gives our Torznab
 * client three escalating defences:
 *
 *   1. Per-host session cookie jar (persists across calls)
 *   2. User-Agent rotation (drawn from a recent-Chrome pool)
 *   3. FlareSolverr fallback when env var FLARESOLVERR_URL is set
 *
 * No-op when FLARESOLVERR_URL is absent — the in-process retries with cookie
 * persistence alone often clear simple JS challenges that hit on cold session.
 */

import { log } from "@/lib/logger";

// ---- User-Agent pool. Real Chrome strings, recent enough to dodge "old browser" UA filters.
const UA_POOL = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
];

function pickUA(seed: string): string {
  // Stable UA per indexer host so the session cookie stays valid across calls
  let h = 0;
  for (const c of seed) h = ((h << 5) - h + c.charCodeAt(0)) | 0;
  return UA_POOL[Math.abs(h) % UA_POOL.length];
}

// ---- In-process cookie jar (per-host) ----
const cookieJars = new Map<string, string>(); // host -> "name1=val1; name2=val2"

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function mergeSetCookie(host: string, setCookieHeaders: string[]): void {
  if (!setCookieHeaders.length) return;
  const existing = parseCookieString(cookieJars.get(host) ?? "");
  for (const header of setCookieHeaders) {
    const [pair] = header.split(";");
    const eq = pair.indexOf("=");
    if (eq < 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) existing[name] = value;
  }
  const serialized = Object.entries(existing)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  cookieJars.set(host, serialized);
}

function parseCookieString(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(";")) {
    const [name, ...rest] = part.split("=");
    if (name && rest.length) out[name.trim()] = rest.join("=").trim();
  }
  return out;
}

function cookieHeader(url: string): string | undefined {
  return cookieJars.get(hostOf(url)) || undefined;
}

// ---- Cloudflare challenge detection ----
// Cloudflare returns 200 OK on the challenge page itself sometimes — sniff
// the body for the telltale markers.
function isCloudflareChallenge(body: string, status: number): boolean {
  if ([403, 429, 503, 521, 522, 523, 524, 525, 526].includes(status)) return true;
  if (!body) return false;
  const sample = body.slice(0, 4096).toLowerCase();
  return (
    sample.includes("just a moment") ||
    sample.includes("cf-chl-bypass") ||
    sample.includes("cf-mitigated") ||
    sample.includes("__cf_chl_") ||
    sample.includes("challenge-platform") ||
    sample.includes("cloudflare to restrict access")
  );
}

// ---- FlareSolverr (optional, when FLARESOLVERR_URL env is set) ----
async function flareSolve(targetUrl: string): Promise<{ body: string; cookies: string[] } | null> {
  const flareUrl = process.env.FLARESOLVERR_URL?.replace(/\/$/, "");
  if (!flareUrl) return null;
  try {
    const res = await fetch(`${flareUrl}/v1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cmd: "request.get",
        url: targetUrl,
        maxTimeout: 60_000,
      }),
    });
    if (!res.ok) {
      log.warn(`flaresolverr ${res.status}`, { url: targetUrl });
      return null;
    }
    const data: any = await res.json();
    if (data.status !== "ok" || !data.solution) {
      log.warn("flaresolverr did not solve", { url: targetUrl, msg: data.message });
      return null;
    }
    const cookies = ((data.solution.cookies ?? []) as any[]).map((c: any) => `${c.name}=${c.value}`);
    return { body: data.solution.response ?? "", cookies };
  } catch (e: any) {
    log.warn("flaresolverr call failed", { message: e.message });
    return null;
  }
}

// ---- Backoff with jitter ----
const BACKOFF_MS = [0, 1500, 4500, 9000]; // first attempt instant, then exponential w/ jitter

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * 800);
}

export type CloudflareFetchResult = {
  ok: boolean;
  body: string;
  status: number;
  attempts: number;
  flaresolverrUsed: boolean;
  error?: string;
};

/**
 * Fetch a URL with Cloudflare-aware retries.
 *
 *   1. Use stable per-host UA + persisted cookie jar
 *   2. On 5xx/challenge body, retry with exponential backoff + jitter
 *   3. On final failure, if FLARESOLVERR_URL is set, route through it
 */
export async function fetchWithCloudflareBypass(
  url: string,
  opts: { acceptXml?: boolean; timeoutMs?: number } = {},
): Promise<CloudflareFetchResult> {
  const ua = pickUA(hostOf(url));
  const accept = opts.acceptXml ? "application/xml,text/xml,*/*" : "*/*";
  const timeoutMs = opts.timeoutMs ?? 25_000;

  let lastStatus = 0;
  let lastBody = "";
  let lastError: string | undefined;

  for (let attempt = 0; attempt < BACKOFF_MS.length; attempt++) {
    const delay = BACKOFF_MS[attempt];
    if (delay > 0) await new Promise((r) => setTimeout(r, jitter(delay)));

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const headers: Record<string, string> = {
        "User-Agent": ua,
        Accept: accept,
        "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
      };
      const ck = cookieHeader(url);
      if (ck) headers.Cookie = ck;
      const res = await fetch(url, { headers, signal: ctrl.signal, redirect: "follow" });
      clearTimeout(t);

      // Persist any Set-Cookie returned
      const setCookies = res.headers.getSetCookie?.() ?? [];
      if (setCookies.length) mergeSetCookie(hostOf(url), setCookies);

      const body = await res.text();
      lastStatus = res.status;
      lastBody = body;

      if (res.ok && !isCloudflareChallenge(body, res.status)) {
        return { ok: true, body, status: res.status, attempts: attempt + 1, flaresolverrUsed: false };
      }
      // Cloudflare-likely failure — log and retry
      log.warn(`cloudflare-bypass: bad response (attempt ${attempt + 1})`, {
        host: hostOf(url),
        status: res.status,
        bodySample: body.slice(0, 120),
      });
    } catch (e: any) {
      lastError = e?.message ?? String(e);
      log.warn(`cloudflare-bypass: fetch threw (attempt ${attempt + 1})`, {
        host: hostOf(url),
        message: lastError,
      });
    }
  }

  // Plain retries exhausted — try FlareSolverr as last resort
  const solved = await flareSolve(url);
  if (solved) {
    // Persist the cookies FlareSolverr extracted so subsequent direct calls work
    mergeSetCookie(hostOf(url), solved.cookies);
    return {
      ok: true,
      body: solved.body,
      status: 200,
      attempts: BACKOFF_MS.length + 1,
      flaresolverrUsed: true,
    };
  }

  return {
    ok: false,
    body: lastBody,
    status: lastStatus,
    attempts: BACKOFF_MS.length,
    flaresolverrUsed: false,
    error: lastError ?? `Cloudflare bypass failed after ${BACKOFF_MS.length} attempts (last status ${lastStatus})`,
  };
}
