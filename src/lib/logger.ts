/**
 * Lightweight structured logger with secret redaction.
 * Avoids accidental leakage of API keys, qBit passwords, and tracker passkeys
 * into stdout / Sentry / log aggregators.
 */

const SECRET_PATTERNS: { re: RegExp; replacement: string }[] = [
  // apikey=xxx in URLs (Torznab, c411, …)
  { re: /([?&](?:apikey|api_key|key|token)=)[^&\s"']+/gi, replacement: "$1***" },
  // Bearer / Authorization tokens
  { re: /(Authorization|X-Api-Key)\s*[:=]\s*["']?[^"'\s,}]+/gi, replacement: "$1: ***" },
  { re: /\bars_[A-Za-z0-9_-]{8,}/g, replacement: "ars_***" },
  // BTC-style hashes are fine to leave (public infohashes).
  // Mongo connection strings
  { re: /(mongodb(?:\+srv)?:\/\/[^:]+:)[^@]+@/gi, replacement: "$1***@" },
];

export function redact(s: string): string {
  let out = s;
  for (const { re, replacement } of SECRET_PATTERNS) out = out.replace(re, replacement);
  return out;
}

function fmt(level: string, msg: string, extra?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const e = extra ? " " + redact(JSON.stringify(extra)) : "";
  return `${ts} [${level}] ${redact(msg)}${e}`;
}

export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => console.log(fmt("info", msg, extra)),
  warn: (msg: string, extra?: Record<string, unknown>) => console.warn(fmt("warn", msg, extra)),
  error: (msg: string, extra?: Record<string, unknown>) => console.error(fmt("error", msg, extra)),
  debug: (msg: string, extra?: Record<string, unknown>) => {
    if (process.env.LOG_LEVEL === "debug") console.log(fmt("debug", msg, extra));
  },
};
