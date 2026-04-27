"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MediaCard } from "@/components/MediaCard";
import { Plus, Loader2, Check, AlertCircle, Zap } from "lucide-react";

type Hit = {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  year?: number;
  overview?: string;
  poster?: string | null;
};

type LibraryItem = { type: "movie" | "tv"; tmdbId: number; status: string };
type Profile = { _id: string; name: string; isDefault: boolean };

type Toast = { kind: "success" | "error"; msg: string } | null;

export default function SearchPage() {
  const router = useRouter();
  const sp = useSearchParams();
  // URL is the source of truth — refresh / share / back-button preserves the query.
  const submitted = sp.get("q") ?? "";
  const [q, setQ] = useState(submitted);
  // Keep input in sync when URL changes (back/forward navigation)
  useEffect(() => setQ(submitted), [submitted]);

  const [autoGrab, setAutoGrab] = useState(true);
  const [profileId, setProfileId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);
  const qc = useQueryClient();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    const trimmed = q.trim();
    if (trimmed) params.set("q", trimmed);
    router.replace(trimmed ? `/search?${params}` : "/search", { scroll: false });
  };

  const { data, isFetching } = useQuery<{ results: Hit[] }>({
    queryKey: ["tmdb", submitted],
    queryFn: async () =>
      submitted ? (await fetch(`/api/tmdb/search?q=${encodeURIComponent(submitted)}`)).json() : { results: [] },
    enabled: !!submitted,
  });

  // Always refetch on mount to keep "already in library" badge fresh after
  // navigating away and back.
  const { data: lib } = useQuery<{ items: LibraryItem[] }>({
    queryKey: ["library"],
    queryFn: async () => (await fetch("/api/library")).json(),
    refetchOnMount: "always",
  });

  const { data: profiles } = useQuery<{ items: Profile[] }>({
    queryKey: ["profiles"],
    queryFn: async () => (await fetch("/api/profiles")).json(),
    refetchOnMount: "always",
  });

  const inLibrary = (h: Hit): LibraryItem | undefined =>
    lib?.items?.find((x) => x.type === h.type && Number(x.tmdbId) === Number(h.tmdbId));

  const add = useMutation({
    mutationFn: async (h: Hit) => {
      const r = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: h.type,
          tmdbId: h.tmdbId,
          autoGrab,
          profileId: profileId ?? undefined,
        }),
      });
      return r.json();
    },
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["downloads"] });
      if (!autoGrab) {
        setToast({ kind: "success", msg: `Ajouté à la library` });
      } else if (resp?.grabbed) {
        setToast({
          kind: "success",
          msg: `Ajouté + grab lancé via "${resp.grab?.profile}"`,
        });
      } else {
        setToast({
          kind: "error",
          msg: `Ajouté mais grab échoué: ${resp?.grab?.error ?? "?"}`,
        });
      }
      setTimeout(() => setToast(null), 6000);
    },
    onError: (e: any) => {
      setToast({ kind: "error", msg: e.message ?? "erreur ajout" });
      setTimeout(() => setToast(null), 6000);
    },
  });

  const defaultProfileName =
    profiles?.items?.find((p) => (profileId ? p._id === profileId : p.isDefault))?.name ?? "default";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-muted text-sm">Movies and TV in one box.</p>
      </header>

      <div className="flex flex-col md:flex-row gap-3">
        <form onSubmit={onSubmit} className="flex gap-2 flex-1">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="The Bear, Dune, Severance..."
            className="flex-1 bg-surface border border-border rounded-md px-4 py-2.5 outline-none focus:border-accent"
          />
          <button className="px-4 py-2.5 bg-accent rounded-md font-medium text-white hover:bg-accent/90">
            Search
          </button>
        </form>

        <div className="flex items-center gap-3 bg-surface border border-border rounded-md px-3 py-2 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoGrab}
              onChange={(e) => setAutoGrab(e.target.checked)}
              className="accent-accent"
            />
            <Zap className="w-3.5 h-3.5 text-accent" />
            Auto-grab
          </label>
          <span className="text-muted">·</span>
          <select
            value={profileId ?? ""}
            onChange={(e) => setProfileId(e.target.value || null)}
            disabled={!autoGrab}
            className="bg-bg border border-border rounded px-2 py-1 text-xs disabled:opacity-50"
            title="Profil utilisé pour l'auto-grab"
          >
            <option value="">— default ({defaultProfileName}) —</option>
            {profiles?.items?.map((p) => (
              <option key={p._id} value={p._id}>
                {p.name}
                {p.isDefault ? " ★" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {toast && (
        <div
          className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm border ${
            toast.kind === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/30 text-rose-400"
          }`}
        >
          {toast.kind === "success" ? (
            <Check className="w-4 h-4" />
          ) : (
            <AlertCircle className="w-4 h-4" />
          )}
          {toast.msg}
        </div>
      )}

      {isFetching && (
        <div className="flex items-center gap-2 text-muted text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Searching TMDB...
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {(data?.results ?? []).map((h) => {
          const owned = inLibrary(h);
          const adding = add.isPending && add.variables?.tmdbId === h.tmdbId;
          return (
            <MediaCard
              key={`${h.type}-${h.tmdbId}`}
              poster={h.poster}
              title={h.title}
              year={h.year}
              type={h.type}
              status={owned?.status}
              rightSlot={
                owned ? (
                  <span
                    title={`Already in library — status: ${owned.status}`}
                    className="p-1 rounded text-emerald-400 bg-emerald-500/10"
                  >
                    <Check className="w-4 h-4" />
                  </span>
                ) : (
                  <button
                    title={autoGrab ? "Add + auto-grab" : "Add to library only"}
                    disabled={adding}
                    onClick={(e) => {
                      e.stopPropagation();
                      add.mutate(h);
                    }}
                    className="p-1 rounded hover:bg-accent/15 text-accent disabled:opacity-50"
                  >
                    {adding ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                  </button>
                )
              }
            />
          );
        })}
      </div>
    </div>
  );
}
