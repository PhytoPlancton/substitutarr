"use client";
import { use, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Search,
  Zap,
  Loader2,
  Check,
  AlertCircle,
  Clock,
  Filter,
  Link2,
} from "lucide-react";
import { SearchModal } from "@/components/SearchModal";

type Episode = {
  number: number;
  name?: string;
  overview?: string;
  airDate?: string;
  runtime?: number;
  status: string;
  monitored?: boolean;
};
type Season = {
  number: number;
  name?: string;
  posterUrl?: string;
  airDate?: string;
  monitored: boolean;
  episodes: Episode[];
};
type Media = {
  _id: string;
  type: "movie" | "tv";
  title: string;
  poster?: string | null;
  seasons?: Season[];
};

export default function SeasonDetailPage({
  params,
}: {
  params: Promise<{ id: string; s: string }>;
}) {
  const { id, s } = use(params);
  const seasonNum = Number(s);
  const qc = useQueryClient();

  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "missing" | "downloaded" | "unaired">("all");
  const [explainEp, setExplainEp] = useState<number | null>(null);

  const { data: mediaData } = useQuery<{ item: Media }>({
    queryKey: ["library", id],
    queryFn: async () => (await fetch(`/api/library/${id}`)).json(),
    refetchInterval: 5000,
  });
  const { data: extrasData } = useQuery<{ extras?: { episodeStills?: Record<string, string> } }>({
    queryKey: ["library-extras", id],
    queryFn: async () => (await fetch(`/api/library/${id}/extras`)).json(),
  });
  const stills = extrasData?.extras?.episodeStills ?? {};

  const media = mediaData?.item;
  const season = media?.seasons?.find((x) => x.number === seasonNum);

  const grabSeason = useMutation({
    mutationFn: async ({ ep }: { ep?: number }) => {
      const qs = ep != null ? `?episode=${ep}` : "";
      const r = await fetch(`/api/library/${id}/season/${seasonNum}/grab${qs}`, { method: "POST" });
      return r.json();
    },
    onSuccess: (r) => {
      if (!r.ok) alert(`Grab failed:\n${r.error ?? "unknown"}`);
      qc.invalidateQueries({ queryKey: ["library", id] });
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });

  const grabMagnet = useMutation({
    mutationFn: async ({ magnet, episode }: { magnet: string; episode: number }) => {
      const r = await fetch("/api/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId: id, magnet, season: seasonNum, episode }),
      });
      return r.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", id] }),
  });

  const filteredEps = useMemo(() => {
    if (!season) return [];
    return season.episodes.filter((e) => {
      if (statusFilter === "missing" && e.status !== "wanted" && e.status !== "missing") return false;
      if (statusFilter === "downloaded" && e.status !== "downloaded") return false;
      if (statusFilter === "unaired" && e.status !== "unaired") return false;
      if (filter) {
        const q = filter.toLowerCase();
        const epLabel = `S${String(seasonNum).padStart(2, "0")}E${String(e.number).padStart(2, "0")}`.toLowerCase();
        return (
          e.name?.toLowerCase().includes(q) ||
          epLabel.includes(q) ||
          String(e.number).includes(q)
        );
      }
      return true;
    });
  }, [season, filter, statusFilter, seasonNum]);

  if (!media || !season) return <div className="text-muted">Loading…</div>;

  const total = season.episodes.length;
  const downloaded = season.episodes.filter((e) => e.status === "downloaded").length;
  const aired = season.episodes.filter((e) => e.status !== "unaired").length;
  const pct = total ? Math.round((downloaded / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-sm">
        <Link href={`/library/${id}`} className="inline-flex items-center gap-1 text-muted hover:text-white">
          <ArrowLeft className="w-4 h-4" /> {media.title}
        </Link>
        <span className="text-muted">·</span>
        <span className="text-white">{season.name ?? `Season ${seasonNum}`}</span>
      </div>

      {/* Compact season header */}
      <header className="bg-surface border border-border rounded-lg p-5 flex gap-5 items-start">
        {season.posterUrl && (
          <div className="relative aspect-[2/3] w-24 shrink-0 rounded-md overflow-hidden">
            <Image src={season.posterUrl} alt="" fill className="object-cover" />
          </div>
        )}
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <h1 className="text-xl font-semibold">
              {season.name ?? `Season ${seasonNum}`}
            </h1>
            <p className="text-xs text-muted mt-1">
              {season.airDate ?? "—"} · {total} episodes · {aired} aired · {downloaded} downloaded
            </p>
          </div>
          <div className="h-1 bg-bg/60 rounded overflow-hidden max-w-md">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => grabSeason.mutate({})}
              disabled={grabSeason.isPending}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50"
            >
              {grabSeason.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
              Grab season pack
            </button>
            <button
              onClick={() => setExplainEp(0)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs border border-border hover:bg-white/5"
            >
              <Search className="w-3.5 h-3.5" /> Search & explain
            </button>
          </div>
        </div>
      </header>

      {/* Toolbar : filter input + status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter episodes…"
            className="w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <div className="inline-flex items-center rounded-md border border-border bg-surface p-0.5 text-xs">
          {([
            ["all", "All"],
            ["missing", "Missing"],
            ["downloaded", "Downloaded"],
            ["unaired", "Unaired"],
          ] as const).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setStatusFilter(v)}
              className={`px-2.5 py-1 rounded transition-colors ${
                statusFilter === v ? "bg-bg text-white shadow-sm" : "text-muted hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Episode list with thumbnails (Plex-style) */}
      <div className="space-y-2">
        {filteredEps.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-8 text-center text-muted text-sm">
            No episodes match.
          </div>
        ) : (
          filteredEps.map((e) => (
            <EpisodeRow
              key={e.number}
              seasonNum={seasonNum}
              ep={e}
              still={stills[`S${seasonNum}E${e.number}`]}
              onGrab={() => grabSeason.mutate({ ep: e.number })}
              onSearch={() => setExplainEp(e.number)}
              onPaste={() => {
                const m = prompt(`Paste a magnet or .torrent URL for S${seasonNum}E${e.number}`);
                if (m?.trim()) grabMagnet.mutate({ magnet: m.trim(), episode: e.number });
              }}
              grabbing={grabSeason.isPending && grabSeason.variables?.ep === e.number}
            />
          ))
        )}
      </div>

      {explainEp !== null && (
        <SearchModal
          mediaId={id}
          mediaTitle={`${media.title} · S${String(seasonNum).padStart(2, "0")}${
            explainEp > 0 ? `E${String(explainEp).padStart(2, "0")}` : ""
          }`}
          onClose={() => setExplainEp(null)}
        />
      )}
    </div>
  );
}

function EpisodeRow({
  seasonNum,
  ep,
  still,
  onGrab,
  onSearch,
  onPaste,
  grabbing,
}: {
  seasonNum: number;
  ep: Episode;
  still?: string;
  onGrab: () => void;
  onSearch: () => void;
  onPaste: () => void;
  grabbing: boolean;
}) {
  const epLabel = `S${String(seasonNum).padStart(2, "0")}E${String(ep.number).padStart(2, "0")}`;
  const canGrab = ep.status !== "downloaded" && ep.status !== "unaired";
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden flex gap-3 hover:border-accent/30 transition-colors">
      {still ? (
        <div className="relative w-32 sm:w-44 shrink-0 aspect-video">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={still} alt="" className="absolute inset-0 w-full h-full object-cover" />
        </div>
      ) : (
        <div className="w-32 sm:w-44 shrink-0 aspect-video bg-black/40 flex items-center justify-center text-muted text-xs">
          {epLabel}
        </div>
      )}
      <div className="flex-1 min-w-0 p-3 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted font-mono">
              {epLabel}
              {ep.airDate && <span className="text-muted/70">· {ep.airDate}</span>}
              {ep.runtime && <span className="text-muted/70">· {ep.runtime}m</span>}
            </div>
            <h3 className="text-sm font-medium truncate">{ep.name ?? "—"}</h3>
            {ep.overview && (
              <p className="text-xs text-muted mt-1 line-clamp-2">{ep.overview}</p>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <EpisodeStatusPill status={ep.status} />
          </div>
        </div>
        <div className="mt-auto pt-2 flex justify-end gap-1">
          <button
            onClick={onSearch}
            title="Search & explain"
            className="p-1 rounded hover:bg-white/5 text-muted"
          >
            <Search className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onPaste}
            title="Paste magnet"
            className="p-1 rounded hover:bg-white/5 text-muted"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onGrab}
            disabled={!canGrab || grabbing}
            title={canGrab ? "Auto-grab" : ep.status === "downloaded" ? "Already downloaded" : "Not aired yet"}
            className="p-1 rounded bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-30"
          >
            {grabbing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function EpisodeStatusPill({ status }: { status: string }) {
  const cfg: Record<string, { color: string; label: string; Icon?: any; spin?: boolean }> = {
    downloaded: { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", Icon: Check, label: "Downloaded" },
    wanted: { color: "text-amber-400 bg-amber-500/10 border-amber-500/20", Icon: AlertCircle, label: "Wanted" },
    snatched: { color: "text-blue-400 bg-blue-500/10 border-blue-500/20", Icon: Loader2, spin: true, label: "Snatched" },
    downloading: { color: "text-blue-400 bg-blue-500/10 border-blue-500/20", Icon: Loader2, spin: true, label: "Downloading" },
    unaired: { color: "text-zinc-500 bg-zinc-700/10 border-zinc-700/30", Icon: Clock, label: "Unaired" },
    missing: { color: "text-rose-400 bg-rose-500/10 border-rose-500/20", Icon: AlertCircle, label: "Missing" },
    unmonitored: { color: "text-muted bg-zinc-700/10 border-zinc-700/30", label: "Unmonitored" },
  };
  const c = cfg[status] ?? { color: "text-muted bg-zinc-700/10 border-zinc-700/30", label: status };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded border ${c.color}`}>
      {c.Icon && <c.Icon className={`w-3 h-3 ${c.spin ? "animate-spin" : ""}`} />}
      {c.label}
    </span>
  );
}
