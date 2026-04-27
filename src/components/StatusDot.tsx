"use client";
import type { ReactNode } from "react";

export type ConnStatus = "unknown" | "testing" | "connected" | "error" | "stale";

const cfg: Record<
  ConnStatus,
  { dot: string; label: string; ping: boolean; text: string }
> = {
  unknown:   { dot: "bg-zinc-400",   label: "Not tested",  ping: false, text: "text-muted" },
  testing:   { dot: "bg-blue-500 animate-pulse", label: "Testing…", ping: false, text: "text-blue-400" },
  connected: { dot: "bg-emerald-500", label: "Connected",  ping: true,  text: "text-emerald-400" },
  error:     { dot: "bg-rose-500",   label: "Error",       ping: false, text: "text-rose-400" },
  stale:     { dot: "bg-amber-500",  label: "Stale",       ping: false, text: "text-amber-400" },
};

export function StatusDot({
  status,
  label,
  hint,
}: {
  status: ConnStatus;
  /** Override the default label ("Connected", "Error", …). */
  label?: string;
  /** Optional secondary text — typically a relative timestamp ("2m ago"). */
  hint?: ReactNode;
}) {
  const c = cfg[status];
  return (
    <span className={`inline-flex items-center gap-2 text-xs font-medium ${c.text}`}>
      <span className="relative flex h-2 w-2">
        {c.ping && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${c.dot}`} />
      </span>
      {label ?? c.label}
      {hint && <span className="text-muted/70 font-normal">· {hint}</span>}
    </span>
  );
}

export function relativeTime(iso?: string | Date | null): string | undefined {
  if (!iso) return undefined;
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = Date.now() - d.getTime();
  if (diff < 0) return "just now";
  const s = Math.round(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
