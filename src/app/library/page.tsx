"use client";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaCard } from "@/components/MediaCard";
import { SearchModal } from "@/components/SearchModal";
import { Link2, Search, Trash2, Zap, MoreHorizontal, ArrowUpCircle } from "lucide-react";
import Link from "next/link";
import { useT } from "@/lib/i18n/I18nProvider";

type Item = {
  _id: string;
  type: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: number;
  poster?: string | null;
  status: string;
  monitored: boolean;
};

type DownloadItem = { mediaId: string; progress?: number; state?: string };

export default function LibraryPage() {
  const t = useT();
  const qc = useQueryClient();
  const [explainItem, setExplainItem] = useState<Item | null>(null);

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

  const items = data?.items ?? [];
  const progressByMedia: Record<string, number> = {};
  for (const d of downloads?.items ?? []) {
    if (d.mediaId && typeof d.progress === "number" && d.state === "downloading") {
      progressByMedia[d.mediaId] = Math.max(progressByMedia[d.mediaId] ?? 0, d.progress);
    }
  }

  const isActive = (s: string) => s === "wanted" || s === "missing" || s === "paused";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("library.title")}</h1>
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
          {items.map((m) => (
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
          ))}
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
