"use client";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Check,
  Clock,
  Loader2,
  Pause,
  Play,
  Search,
  ShieldCheck,
  X,
  XCircle,
  AlertTriangle,
  Inbox,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

type Item = {
  _id: string;
  mediaId?: string;
  title: string;
  indexer?: string;
  quality?: string;
  sizeBytes?: number;
  qbHash?: string;
  bucket: "active" | "queued" | "completed" | "failed";
  label: string;
  warning?: boolean;
  showProgress?: boolean;
  progress?: number;
  qbState?: string;
  dlspeed?: number;
  eta?: number;
  addedAt?: string;
  completedAt?: string;
  season?: number;
  episode?: number;
};

const fmtBytes = (b?: number) => {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0,
    v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${u[i]}`;
};
const fmtEta = (s?: number) => {
  if (!s || s === 8640000 || s < 0) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};
const fmtRelTime = (iso?: string) => {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

export default function DownloadsPage() {
  const t = useT();
  const qc = useQueryClient();
  const [showCompleted, setShowCompleted] = useState(false);
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "failed">("all");
  const [completedOpen, setCompletedOpen] = useState(false);

  const { data } = useQuery<{ items: Item[]; counts: Record<string, number> }>({
    queryKey: ["downloads", showCompleted],
    queryFn: async () =>
      (await fetch(`/api/downloads${showCompleted ? "?showCompleted=1" : ""}`)).json(),
    refetchInterval: (q) => {
      const items = (q.state.data as any)?.items ?? [];
      const hasActive = items.some((i: Item) => i.bucket === "active" && i.showProgress);
      return hasActive ? 1500 : 10_000;
    },
  });

  const remove = useMutation({
    mutationFn: async ({ id, files }: { id: string; files: boolean }) =>
      fetch(`/api/downloads/${id}?files=${files ? 1 : 0}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const action = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "pause" | "resume" }) =>
      fetch(`/api/downloads/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });
  const clearCompleted = useMutation({
    mutationFn: async () =>
      fetch("/api/downloads/clear-completed", { method: "POST" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const items = data?.items ?? [];
  const counts = data?.counts ?? { active: 0, queued: 0, completed: 0, failed: 0 };

  const filtered = useMemo(() => {
    let out = items;
    if (statusFilter === "active") out = out.filter((i) => i.bucket === "active");
    if (statusFilter === "failed") out = out.filter((i) => i.bucket === "failed");
    if (filter) {
      const q = filter.toLowerCase();
      out = out.filter(
        (i) => i.title.toLowerCase().includes(q) || i.indexer?.toLowerCase().includes(q),
      );
    }
    return out;
  }, [items, statusFilter, filter]);

  const grouped = useMemo(() => {
    const buckets: Record<string, Item[]> = { active: [], queued: [], failed: [], completed: [] };
    for (const i of filtered) buckets[i.bucket]?.push(i);
    // Active sort: downloading first → warning → paused
    buckets.active.sort((a, b) => {
      const score = (x: Item) =>
        x.label === "Downloading" ? 0 : x.warning ? 1 : x.label === "Paused" ? 2 : 3;
      return score(a) - score(b) || (b.addedAt ?? "").localeCompare(a.addedAt ?? "");
    });
    // Completed: most recent first
    buckets.completed.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
    return buckets;
  }, [filtered]);

  const totalShown = filtered.length;
  const isEmpty = items.length === 0;

  return (
    <div className="space-y-5 max-w-5xl">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-semibold">{t("downloads.title")}</h1>
        <div className="flex items-center gap-2">
          {counts.completed > 0 && (
            <button
              onClick={() => clearCompleted.mutate()}
              className="text-xs text-muted hover:text-white inline-flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear completed ({counts.completed})
            </button>
          )}
        </div>
      </header>

      {/* Counters bar */}
      <div className="text-xs text-muted">
        <span className="text-purple-400">{counts.active} active</span> ·{" "}
        <span>{counts.queued} queued</span> ·{" "}
        <span className="text-rose-400">{counts.failed} failed</span> ·{" "}
        <span className="text-emerald-400">{counts.completed} completed</span>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search…"
            className="w-full bg-surface border border-border rounded-md pl-9 pr-3 py-1.5 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="inline-flex items-center rounded-md border border-border bg-surface p-0.5 text-xs">
          {(["all", "active", "failed"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`px-2.5 py-1 rounded transition-colors capitalize ${
                statusFilter === v ? "bg-bg text-white shadow-sm" : "text-muted hover:text-white"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={(e) => setShowCompleted(e.target.checked)}
            className="accent-accent"
          />
          Show all completed
        </label>
      </div>

      {isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {grouped.active.length > 0 && (
            <Section title="Active" count={grouped.active.length}>
              {grouped.active.map((i) => (
                <Row
                  key={i._id}
                  item={i}
                  onAction={(act) => action.mutate({ id: i._id, action: act })}
                  onRemove={(files) => remove.mutate({ id: i._id, files })}
                />
              ))}
            </Section>
          )}
          {grouped.queued.length > 0 && (
            <Section title="Queued" count={grouped.queued.length}>
              {grouped.queued.map((i) => (
                <Row
                  key={i._id}
                  item={i}
                  onAction={(act) => action.mutate({ id: i._id, action: act })}
                  onRemove={(files) => remove.mutate({ id: i._id, files })}
                />
              ))}
            </Section>
          )}
          {grouped.failed.length > 0 && (
            <Section title="Failed" count={grouped.failed.length} accent="rose">
              {grouped.failed.map((i) => (
                <Row
                  key={i._id}
                  item={i}
                  onAction={(act) => action.mutate({ id: i._id, action: act })}
                  onRemove={(files) => remove.mutate({ id: i._id, files })}
                />
              ))}
            </Section>
          )}
          {grouped.completed.length > 0 && (
            <CollapsibleSection
              title="Recently completed"
              count={grouped.completed.length}
              open={completedOpen}
              onToggle={() => setCompletedOpen((v) => !v)}
            >
              {grouped.completed.map((i) => (
                <Row
                  key={i._id}
                  item={i}
                  faded
                  onAction={(act) => action.mutate({ id: i._id, action: act })}
                  onRemove={(files) => remove.mutate({ id: i._id, files })}
                />
              ))}
            </CollapsibleSection>
          )}
          {totalShown === 0 && !isEmpty && (
            <p className="text-sm text-muted text-center py-6">No matching downloads.</p>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-surface border border-border rounded-lg p-12 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mb-4">
        <Inbox className="w-5 h-5 text-accent" />
      </div>
      <div className="font-medium">Nothing in the queue</div>
      <p className="text-sm text-muted mt-1 max-w-sm">
        Add a movie or episode from the library to start a download.
      </p>
    </div>
  );
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string;
  count: number;
  accent?: "rose";
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className={`text-[10px] font-semibold uppercase tracking-wider mb-2 ${
        accent === "rose" ? "text-rose-400" : "text-muted"
      }`}>
        {title} <span className="text-muted/60 ml-1">({count})</span>
      </h2>
      <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function CollapsibleSection({
  title,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70 hover:text-muted mb-2"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {title} <span className="text-muted/50 ml-1">({count})</span>
      </button>
      {open && (
        <div className="bg-surface border border-border rounded-lg divide-y divide-border overflow-hidden">
          {children}
        </div>
      )}
    </section>
  );
}

function StatusPill({ item }: { item: Item }) {
  const cfg = (() => {
    switch (item.label) {
      case "Downloading":
        return { color: "text-purple-400 bg-purple-500/10 border-purple-500/20", Icon: ArrowDownToLine };
      case "Starting":
      case "Pending":
      case "Importing":
        return { color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20", Icon: Loader2, spin: true };
      case "Verifying":
        return { color: "text-sky-400 bg-sky-500/10 border-sky-500/20", Icon: ShieldCheck };
      case "Stalled":
        return { color: "text-amber-400 bg-amber-500/10 border-amber-500/20", Icon: AlertTriangle };
      case "Paused":
        return { color: "text-zinc-300 bg-zinc-500/15 border-zinc-500/30", Icon: Pause };
      case "Queued":
        return { color: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20", Icon: Clock };
      case "Done":
        return { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", Icon: Check };
      case "Failed":
        return { color: "text-rose-400 bg-rose-500/10 border-rose-500/20", Icon: XCircle };
      default:
        return { color: "text-muted bg-zinc-500/10 border-zinc-500/20", Icon: Clock };
    }
  })() as { color: string; Icon: any; spin?: boolean };

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.color}`}>
      <cfg.Icon className={`w-3 h-3 ${cfg.spin ? "animate-spin" : ""}`} />
      {item.label}
    </span>
  );
}

function Row({
  item,
  faded,
  onAction,
  onRemove,
}: {
  item: Item;
  faded?: boolean;
  onAction: (a: "pause" | "resume") => void;
  onRemove: (files: boolean) => void;
}) {
  const isActive = item.bucket === "active";
  const isPaused = item.label === "Paused";
  return (
    <div
      className={`group flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors ${
        item.warning ? "border-l-2 border-amber-500/60" : "border-l-2 border-transparent"
      } ${faded ? "opacity-70" : ""}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{item.title}</div>
        <div className="text-[11px] text-muted flex items-center gap-2 flex-wrap">
          {item.indexer && <span>{item.indexer}</span>}
          {item.quality && (
            <>
              <span>·</span>
              <span>{item.quality}</span>
            </>
          )}
          {item.sizeBytes ? (
            <>
              <span>·</span>
              <span>{fmtBytes(item.sizeBytes)}</span>
            </>
          ) : null}
          {item.addedAt && (
            <>
              <span>·</span>
              <span>added {fmtRelTime(item.addedAt)}</span>
            </>
          )}
        </div>
        {item.showProgress && (
          <div className="mt-1.5 h-1 rounded-full bg-bg/60 overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-[width]"
              style={{ width: `${Math.round((item.progress ?? 0) * 100)}%` }}
            />
          </div>
        )}
      </div>

      <StatusPill item={item} />

      {item.showProgress && (
        <div className="text-[11px] tabular-nums text-muted w-20 text-right shrink-0">
          <div>{fmtBytes(item.dlspeed)}/s</div>
          <div className="text-muted/70">ETA {fmtEta(item.eta)}</div>
        </div>
      )}

      <div className="flex items-center gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
        {isActive && !isPaused && (
          <button
            onClick={() => onAction("pause")}
            title="Pause"
            className="p-1 rounded hover:bg-white/5 text-muted"
          >
            <Pause className="w-3.5 h-3.5" />
          </button>
        )}
        {isActive && isPaused && (
          <button
            onClick={() => onAction("resume")}
            title="Resume"
            className="p-1 rounded hover:bg-white/5 text-muted"
          >
            <Play className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => {
            const withFiles = confirm(
              `Remove "${item.title}" — also delete files from disk?\n\nClick OK = delete files, Cancel = keep files`,
            );
            onRemove(withFiles);
          }}
          title="Remove"
          className="p-1 rounded hover:bg-rose-500/15 text-rose-400"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
