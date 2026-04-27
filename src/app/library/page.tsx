"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaCard } from "@/components/MediaCard";
import { SearchModal } from "@/components/SearchModal";
import { Link2, Search, Trash2, Zap } from "lucide-react";

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

export default function LibraryPage() {
  const qc = useQueryClient();
  const [explainItem, setExplainItem] = useState<Item | null>(null);
  const { data } = useQuery<{ items: Item[] }>({
    queryKey: ["library"],
    queryFn: async () => (await fetch("/api/library")).json(),
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

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Library</h1>
        <p className="text-muted text-sm">{items.length} items · monitored automatically.</p>
      </header>

      {items.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-10 text-center text-muted">
          Empty. Use <span className="text-accent">Search</span> to add something.
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
              rightSlot={
                <div className="flex gap-1">
                  <button
                    title="Search & explain (see all releases, why one was picked)"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExplainItem(m);
                    }}
                    className="p-1 rounded hover:bg-accent/15 text-accent"
                  >
                    <Search className="w-4 h-4" />
                  </button>
                  <button
                    title="Auto-grab via profile"
                    onClick={(e) => {
                      e.stopPropagation();
                      grab.mutate(m._id);
                    }}
                    className="p-1 rounded hover:bg-accent/15 text-accent"
                  >
                    <Zap className="w-4 h-4" />
                  </button>
                  <button
                    title="Paste magnet link"
                    onClick={(e) => {
                      e.stopPropagation();
                      const magnet = prompt(`Paste a magnet link for "${m.title}"`);
                      if (magnet?.trim()) grabMagnet.mutate({ mediaId: m._id, magnet: magnet.trim() });
                    }}
                    className="p-1 rounded hover:bg-accent/15 text-accent"
                  >
                    <Link2 className="w-4 h-4" />
                  </button>
                  <button
                    title="Remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Remove ${m.title}?`)) remove.mutate(m._id);
                    }}
                    className="p-1 rounded hover:bg-rose-500/15 text-rose-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
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
