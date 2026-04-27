import dns from "node:dns/promises";

/**
 * Validate that a user-provided URL (e.g. a Torznab indexer) doesn't point
 * to private/loopback/link-local IPs which would expose internal services
 * (cloud metadata, internal LANs, …).
 */

const PRIVATE_RANGES_V4: [number, number][] = [
  // 10.0.0.0/8
  [0x0a000000, 0x0affffff],
  // 172.16.0.0/12
  [0xac100000, 0xac1fffff],
  // 192.168.0.0/16
  [0xc0a80000, 0xc0a8ffff],
  // 127.0.0.0/8 loopback
  [0x7f000000, 0x7fffffff],
  // 169.254.0.0/16 link-local (AWS metadata uses 169.254.169.254)
  [0xa9fe0000, 0xa9feffff],
  // 0.0.0.0/8
  [0x00000000, 0x00ffffff],
];

function ipToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isFinite(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function isPrivateV4(ip: string): boolean {
  const n = ipToInt(ip);
  if (n === null) return false;
  return PRIVATE_RANGES_V4.some(([lo, hi]) => n >= lo && n <= hi);
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // IPv4-mapped IPv6 ::ffff:127.0.0.1
  if (lower.startsWith("::ffff:")) {
    const v4 = lower.slice(7);
    return isPrivateV4(v4);
  }
  return false;
}

export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("invalid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`scheme not allowed: ${url.protocol}`);
  }
  // Allow bypass in dev/local-only deployments via explicit env opt-out
  if (process.env.SSRF_GUARD_DISABLED === "1") return;

  const host = url.hostname;
  // Direct IPv4/IPv6 literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isPrivateV4(host)) throw new Error(`private/loopback IP not allowed: ${host}`);
    return;
  }
  if (host.includes(":")) {
    if (isPrivateV6(host)) throw new Error(`private/loopback IPv6 not allowed: ${host}`);
    return;
  }
  // DNS resolve and check every A/AAAA record
  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`DNS resolution failed for ${host}`);
  }
  for (const r of records) {
    const bad = r.family === 4 ? isPrivateV4(r.address) : isPrivateV6(r.address);
    if (bad) throw new Error(`host ${host} resolves to private IP ${r.address}`);
  }
}
