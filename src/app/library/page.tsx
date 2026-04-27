"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaCard } from "@/components/MediaCard";
import { SearchModal } from "@/components/SearchModal";
import { Link2, Search, Trash2, Zap, MoreHorizontal, ArrowUpCircle } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n/I18nProvider";

type Episode = { number: number; status: string };
type Season = { number: number; monitored?: boolean; episodes?: Episode[] };
type Item = {
  _id: string;
  type: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: number;
  poster?: string | null;
  status: string;
  monitored: boolean;
  seasons?: Season[];
  tmdbStatus?: string;
};

type DownloadItem = { mediaId: string; progress?: number; state?: string };

export default function LibraryPage() {
  const t = useT();
  const qc = useQueryClient();
  const router = useRouter();
  const [explainItem, setExplainItem] = useState<Item | null>(null);
  const [filter, setFilter] = useState<"all" | "movie" | "tv">("all");

  const { data } = useQuery<{ items: Item[] }>({
    queryKey: ["library"],
    queryFn: async () => (await fetch("/api/library")).json(),
  });
  // Read live download progress for items currently downloading.
  const { data: downloads } = useQuery<{ items: DownloadItem[] }>({
    queryKey: ["downloads"],
    queryFn: async () => (await fetch("/api/downloads")).json(),
    refetchInterval: 5000,
  });

  const handleResult = (r: { ok: boolean; error?: string }, ctx: string) => {
    if (!r.ok) alert(`${ctx} failed:\n${r.error ?? "unknown error"}`);
    qc.invalidateQueries({ queryKey: ["library"] });
    qc.invalidateQueries({ queryKey: ["downloads"] });
  };

  const grab = useMutation({
    mutationFn: async (mediaId: string) =>
      fetch("/api/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId }),
      }).then((r) => r.json()),
    onSuccess: (r) => handleResult(r, "Auto-grab"),
  });

  const grabMagnet = useMutation({
    mutationFn: async ({ mediaId, magnet }: { mediaId: string; magnet: string }) =>
      fetch("/api/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId, magnet }),
      }).then((r) => r.json()),
    onSuccess: (r) => handleResult(r, "Manual magnet"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) =>
      fetch(`/api/library/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library"] }),
  });

  const allItems = data?.items ?? [];
  const items = filter === "all" ? allItems : allItems.filter((i) => i.type === filter);
  const progressByMedia: Record<string, number> = {};
  for (const d of downloads?.items ?? []) {
    if (d.mediaId && typeof d.progress === "number" && d.state === "downloading") {
      progressByMedia[d.mediaId] = Math.max(progressByMedia[d.mediaId] ?? 0, d.progress);
    }
  }

  const isActive = (s: string) => s === "wanted" || s === "missing" || s === "paused";

  // For TV cards, derive a quick stats object instead of using global status.
  const tvStats = (m: Item) => {
    const seasons = (m.seasons ?? []).filter((s) => (s.number ?? 0) > 0);
    let total = 0,
      downloaded = 0,
      aired = 0;
    let monitoredSeasons = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const s of seasons) {
      if (s.monitored) monitoredSeasons++;
      for (const e of s.episodes ?? []) {
        total++;
        if ((e as any).airDate && (e as any).airDate <= today) aired++;
        if (e.status === "downloaded") downloaded++;
      }
    }
    return {
      seasonCount: seasons.length,
      monitoredSeasons,
      total,
      downloaded,
      aired,
      isAiring: m.tmdbStatus === "returning_series" || m.tmdbStatus === "in_production",
    };
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("library.title")}</h1>
        <div className="inline-flex items-center rounded-md border border-border bg-surface p-0.5 text-xs">
          {(["all", "movie", "tv"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded transition-colors ${
                filter === f
                  ? "bg-bg text-white shadow-sm"
                  : "text-muted hover:text-white"
              }`}
            >
              {f === "all" ? "All" : f === "movie" ? "Movies" : "TV"}
            </button>
          ))}
        </div>
      </header>

      {items.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-10 text-center text-muted">
          {t("library.emptyPre")}
          <Link className="text-accent" href="/search">
            {t("library.emptyAction")}
          </Link>
          {t("library.emptyPost")}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {items.map((m) => {
            if (m.type === "tv") {
              const s = tvStats(m);
              return (
                <TvCard
                  key={m._id}
                  item={m}
                  stats={s}
                  onOpen={() => router.push(`/library/${m._id}`)}
                  onSearch={() => setExplainItem(m)}
                  onRemove={() => {
                    if (confirm(t("library.removeConfirm", { title: m.title })))
                      remove.mutate(m._id);
                  }}
                />
              );
            }
            return (
              <MediaCard
                key={m._id}
                poster={m.poster}
                title={m.title}
                year={m.year}
                type={m.type}
                status={m.status}
                progress={progressByMedia[m._id]}
                rightSlot={
                  <ItemActions
                    item={m}
                    showGrab={isActive(m.status)}
                    showPaste={isActive(m.status)}
                    onSearch={() => setExplainItem(m)}
                    onGrab={() => grab.mutate(m._id)}
                    onPaste={() => {
                      const magnet = prompt(t("library.pasteMagnetPrompt", { title: m.title }));
                      if (magnet?.trim())
                        grabMagnet.mutate({ mediaId: m._id, magnet: magnet.trim() });
                    }}
                    onRemove={() => {
                      if (confirm(t("library.removeConfirm", { title: m.title })))
                        remove.mutate(m._id);
                    }}
                  />
                }
              />
            );
          })}
        </div>
      )}

      {explainItem && (
        <SearchModal
          mediaId={explainItem._id}
          mediaTitle={`${explainItem.title}${explainItem.year ? ` (${explainItem.year})` : ""}`}
          onClose={() => setExplainItem(null)}
        />
      )}
    </div>
  );
}

function TvCard({
  item,
  stats,
  onOpen,
  onSearch,
  onRemove,
}: {
  item: Item;
  stats: { seasonCount: number; monitoredSeasons: number; total: number; downloaded: number; aired: number; isAiring: boolean };
  onOpen: () => void;
  onSearch: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const pct = stats.aired ? Math.round((stats.downloaded / stats.aired) * 100) : 0;
  return (
    <div
      onClick={onOpen}
      className="bg-surface border border-border rounded-lg cursor-pointer hover:border-accent/40 transition-colors"
    >
      <div className="relative aspect-[2/3] bg-black/30 rounded-t-lg overflow-hidden">
        {item.poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.poster} alt={item.title} className="absolute inset-0 w-full h-full object-cover" />
        ) : null}
        {stats.isAiring && (
          <div className="absolute top-2 right-2 rounded bg-accent/90 px-1.5 py-0.5 text-[10px] font-medium text-white shadow">
            airing
          </div>
        )}
        {stats.aired > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium text-sm truncate">{item.title}</h3>
            <p className="text-[11px] text-muted">
              {item.year ?? "—"} · {stats.seasonCount} season{stats.seasonCount > 1 ? "s" : ""}
            </p>
            <p className="text-[11px] text-muted">
              {stats.downloaded}/{stats.aired || 0} aired ep
            </p>
          </div>
          <div className="flex gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <button
              title={t("library.searchExplain")}
              onClick={onSearch}
              className="p-1 rounded hover:bg-accent/15 text-accent"
            >
              <Search className="w-4 h-4" />
            </button>
            <button
              title={t("library.remove")}
              onClick={onRemove}
              className="p-1 rounded hover:bg-rose-500/15 text-rose-400"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ItemActions({
  item,
  showGrab,
  showPaste,
  onSearch,
  onGrab,
  onPaste,
  onRemove,
}: {
  item: Item;
  showGrab: boolean;
  showPaste: boolean;
  onSearch: () => void;
  onGrab: () => void;
  onPaste: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  return (
    <div className="flex gap-1 relative" ref={ref}>
      <button
        title={t("library.searchExplain")}
        onClick={(e) => {
          e.stopPropagation();
          onSearch();
        }}
        className="p-1 rounded hover:bg-accent/15 text-accent"
      >
        <Search className="w-4 h-4" />
      </button>

      {showGrab && (
        <button
          title={t("library.autoGrabTitle")}
          onClick={(e) => {
            e.stopPropagation();
            onGrab();
          }}
          className="p-1 rounded hover:bg-accent/15 text-accent"
        >
          <Zap className="w-4 h-4" />
        </button>
      )}

      {showPaste && (
        <button
          title={t("library.pasteMagnet")}
          onClick={(e) => {
            e.stopPropagation();
            onPaste();
          }}
          className="p-1 rounded hover:bg-accent/15 text-accent"
        >
          <Link2 className="w-4 h-4" />
        </button>
      )}

      {/* Kebab menu — for `downloaded`/`downloading`, holds the secondary actions
          (upgrade quality, replace via magnet) without crowding the card. */}
      {!showGrab && (
        <button
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="p-1 rounded hover:bg-white/5 text-muted"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      )}

      <button
        title={t("library.remove")}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="p-1 rounded hover:bg-rose-500/15 text-rose-400"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {menuOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-md shadow-xl text-xs whitespace-nowrap py-1 min-w-[180px]"
        >
          <button
            onClick={() => {
              setMenuOpen(false);
              onGrab();
            }}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 w-full text-left"
          >
            <ArrowUpCircle className="w-3.5 h-3.5" /> Upgrade quality
          </button>
          <button
            onClick={() => {
              setMenuOpen(false);
              onPaste();
            }}
            className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 w-full text-left"
          >
            <Link2 className="w-3.5 h-3.5" /> Replace with magnet…
          </button>
        </div>
      )}
    </div>
  );
}
