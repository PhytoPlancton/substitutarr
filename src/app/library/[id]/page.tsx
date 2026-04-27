"use client";
import { use, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Search,
  Zap,
  Loader2,
  ChevronDown,
  ChevronUp,
  Check,
  AlertCircle,
  Clock,
  Trash2,
} from "lucide-react";
import { SearchModal } from "@/components/SearchModal";

type Episode = {
  number: number;
  name?: string;
  airDate?: string;
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
  year?: number;
  overview?: string;
  poster?: string | null;
  backdrop?: string | null;
  tmdbStatus?: string;
  nextAirDate?: string;
  seasons?: Season[];
};

export default function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [explainCtx, setExplainCtx] = useState<{ season?: number; episode?: number } | null>(null);
  const [openSeason, setOpenSeason] = useState<number | null>(null);

  const { data, isLoading } = useQuery<{ item: Media }>({
    queryKey: ["library", id],
    queryFn: async () => (await fetch(`/api/library/${id}`)).json(),
    refetchInterval: 5000,
  });

  const grabSeason = useMutation({
    mutationFn: async ({ s, ep }: { s: number; ep?: number }) => {
      const qs = ep != null ? `?episode=${ep}` : "";
      const r = await fetch(`/api/library/${id}/season/${s}/grab${qs}`, { method: "POST" });
      return r.json();
    },
    onSuccess: (r) => {
      if (!r.ok) alert(`Grab failed:\n${r.error ?? "unknown"}`);
      qc.invalidateQueries({ queryKey: ["library", id] });
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });

  const toggleSeasonMonitor = useMutation({
    mutationFn: async ({ s, monitored }: { s: number; monitored: boolean }) => {
      await fetch(`/api/library/${id}/season/${s}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ monitored }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["library", id] }),
  });

  const remove = useMutation({
    mutationFn: async () =>
      fetch(`/api/library/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library"] });
      window.location.href = "/library";
    },
  });

  if (isLoading || !data?.item) return <div className="text-muted">Loading…</div>;
  const m = data.item;
  const isTv = m.type === "tv";
  const seasons = (m.seasons ?? []).filter((s) => s.number > 0);
  const specials = (m.seasons ?? []).find((s) => s.number === 0);

  const totals = seasons.reduce(
    (acc, s) => {
      const aired = s.episodes.filter((e) => e.status !== "unaired").length;
      const dl = s.episodes.filter((e) => e.status === "downloaded").length;
      acc.aired += aired;
      acc.dl += dl;
      acc.total += s.episodes.length;
      return acc;
    },
    { aired: 0, dl: 0, total: 0 },
  );
  const monitoredCount = seasons.filter((s) => s.monitored).length;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/library"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Library
        </Link>
      </div>

      <header className="relative rounded-lg overflow-hidden bg-surface border border-border">
        {m.backdrop && (
          <div className="absolute inset-0 -z-0">
            <Image src={m.backdrop} alt="" fill className="object-cover opacity-25" />
            <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/60 to-transparent" />
          </div>
        )}
        <div className="relative z-10 flex gap-6 p-6">
          {m.poster && (
            <div className="relative aspect-[2/3] w-32 shrink-0 rounded-md overflow-hidden">
              <Image src={m.poster} alt={m.title} fill className="object-cover" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <h1 className="text-2xl font-semibold">{m.title}</h1>
                <p className="text-sm text-muted">
                  {m.year ?? "—"}
                  {isTv && m.tmdbStatus && (
                    <>
                      {" · "}
                      <span className={tmdbStatusColor(m.tmdbStatus)}>
                        {tmdbStatusLabel(m.tmdbStatus)}
                      </span>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => confirm(`Remove "${m.title}"?`) && remove.mutate()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-xs hover:bg-rose-500/15 text-rose-400 border border-border"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            </div>

            {m.overview && <p className="text-sm text-muted/80 line-clamp-3 max-w-2xl">{m.overview}</p>}

            {isTv && (
              <div className="flex items-center gap-4 text-xs text-muted flex-wrap">
                <span>
                  <strong className="text-white">{totals.dl}</strong> / {totals.aired} aired episodes
                </span>
                <span>·</span>
                <span>{seasons.length} seasons</span>
                <span>·</span>
                <span>{monitoredCount} monitored</span>
                {m.nextAirDate && (
                  <>
                    <span>·</span>
                    <span className="text-amber-400">Next: {m.nextAirDate}</span>
                  </>
                )}
              </div>
            )}

            {isTv && (
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={() => setExplainCtx({})}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs bg-accent/15 text-accent hover:bg-accent/25"
                >
                  <Search className="w-3.5 h-3.5" /> Search & explain
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {isTv ? (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted">Seasons</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {seasons.map((s) => (
              <SeasonCard
                key={s.number}
                season={s}
                isOpen={openSeason === s.number}
                onToggleOpen={() =>
                  setOpenSeason(openSeason === s.number ? null : s.number)
                }
                onToggleMonitor={(monitored) =>
                  toggleSeasonMonitor.mutate({ s: s.number, monitored })
                }
                onGrabPack={() => grabSeason.mutate({ s: s.number })}
                onSearch={() => setExplainCtx({ season: s.number })}
                grabbing={grabSeason.isPending && grabSeason.variables?.s === s.number}
              />
            ))}
          </div>

          {openSeason !== null && (
            <EpisodeTable
              season={(m.seasons ?? []).find((x) => x.number === openSeason)!}
              onGrabEpisode={(ep) => grabSeason.mutate({ s: openSeason, ep })}
              onSearchEpisode={(ep) => setExplainCtx({ season: openSeason, episode: ep })}
            />
          )}

          {specials && specials.episodes.length > 0 && (
            <details className="bg-surface border border-border rounded-lg p-4">
              <summary className="cursor-pointer text-sm text-muted">
                Specials ({specials.episodes.length} episodes)
              </summary>
              <div className="mt-3">
                <EpisodeTable
                  season={specials}
                  onGrabEpisode={(ep) => grabSeason.mutate({ s: 0, ep })}
                  onSearchEpisode={(ep) => setExplainCtx({ season: 0, episode: ep })}
                />
              </div>
            </details>
          )}
        </section>
      ) : (
        <section className="bg-surface border border-border rounded-lg p-6 text-sm text-muted">
          Movie detail page coming soon. Use the Library grid actions for now.
        </section>
      )}

      {explainCtx && (
        <SearchModal
          mediaId={id}
          mediaTitle={`${m.title}${
            explainCtx.season != null
              ? ` · S${String(explainCtx.season).padStart(2, "0")}${
                  explainCtx.episode != null ? `E${String(explainCtx.episode).padStart(2, "0")}` : ""
                }`
              : ""
          }`}
          onClose={() => setExplainCtx(null)}
        />
      )}
    </div>
  );
}

function tmdbStatusLabel(s?: string): string {
  switch (s) {
    case "returning_series": return "Continuing";
    case "ended": return "Ended";
    case "canceled": return "Canceled";
    case "in_production": return "In production";
    case "planned": return "Planned";
    default: return s ?? "";
  }
}
function tmdbStatusColor(s?: string): string {
  switch (s) {
    case "returning_series":
    case "in_production":
      return "text-emerald-400";
    case "ended":
      return "text-zinc-400";
    case "canceled":
      return "text-rose-400";
    default:
      return "text-muted";
  }
}

function SeasonCard({
  season,
  isOpen,
  onToggleOpen,
  onToggleMonitor,
  onGrabPack,
  onSearch,
  grabbing,
}: {
  season: Season;
  isOpen: boolean;
  onToggleOpen: () => void;
  onToggleMonitor: (m: boolean) => void;
  onGrabPack: () => void;
  onSearch: () => void;
  grabbing: boolean;
}) {
  const eps = season.episodes;
  const total = eps.length;
  const dl = eps.filter((e) => e.status === "downloaded").length;
  const wanted = eps.filter((e) => e.status === "wanted").length;
  const unaired = eps.filter((e) => e.status === "unaired").length;
  const aired = total - unaired;

  let stateLabel = "Future";
  let stateClass = "border-zinc-800 opacity-60";
  if (!season.monitored) {
    stateLabel = "Unmonitored";
    stateClass = "border-dashed border-zinc-800";
  } else if (aired === 0) {
    stateLabel = "Future";
  } else if (dl === aired) {
    stateLabel = "Complete";
    stateClass = "border-zinc-800";
  } else if (unaired > 0) {
    stateLabel = "Airing";
    stateClass = "border-accent/50";
  } else {
    stateLabel = "Missing";
    stateClass = "border-amber-500/40";
  }

  const pct = total ? Math.round((dl / total) * 100) : 0;

  return (
    <div className={`bg-surface border ${stateClass} rounded-lg p-3 flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-mono text-muted">S{String(season.number).padStart(2, "0")}</div>
          <div className="text-xs">{stateLabel}</div>
        </div>
        <button
          title={season.monitored ? "Unmonitor" : "Monitor"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleMonitor(!season.monitored);
          }}
          className={`shrink-0 w-7 h-4 rounded-full relative transition-colors ${
            season.monitored ? "bg-accent" : "bg-zinc-700"
          }`}
        >
          <span
            className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
              season.monitored ? "translate-x-3.5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>

      <div>
        <div className="text-xs text-muted">
          {dl}/{aired || 0} ep
        </div>
        <div className="h-1 mt-1 bg-bg/60 rounded overflow-hidden">
          <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex gap-1 mt-1">
        <button
          onClick={onToggleOpen}
          className="flex-1 inline-flex items-center justify-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-white/5"
        >
          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {isOpen ? "Hide" : "Episodes"}
        </button>
        <button
          onClick={onSearch}
          title="Search & explain releases"
          className="px-2 py-1 rounded border border-border hover:bg-white/5"
        >
          <Search className="w-3 h-3" />
        </button>
        <button
          onClick={onGrabPack}
          disabled={grabbing}
          title="Auto-grab season pack"
          className="px-2 py-1 rounded bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-50"
        >
          {grabbing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
        </button>
      </div>
    </div>
  );
}

function EpisodeTable({
  season,
  onGrabEpisode,
  onSearchEpisode,
}: {
  season: Season;
  onGrabEpisode: (ep: number) => void;
  onSearchEpisode: (ep: number) => void;
}) {
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between bg-bg/40 px-3 py-2 border-b border-border">
        <div className="text-xs font-medium">
          {season.name ?? `Season ${season.number}`}
          <span className="text-muted ml-2">{season.episodes.length} episodes</span>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="bg-bg/40 text-muted text-[10px] uppercase tracking-wider">
          <tr>
            <th className="text-left px-3 py-2 font-medium">#</th>
            <th className="text-left px-3 py-2 font-medium">Title</th>
            <th className="text-left px-3 py-2 font-medium">Air date</th>
            <th className="text-left px-3 py-2 font-medium">Status</th>
            <th className="text-right px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {season.episodes.map((e) => (
            <tr key={e.number} className="border-t border-border hover:bg-white/2">
              <td className="px-3 py-2 font-mono text-muted">
                S{String(season.number).padStart(2, "0")}E{String(e.number).padStart(2, "0")}
              </td>
              <td className="px-3 py-2">{e.name ?? "—"}</td>
              <td className="px-3 py-2 text-muted">{e.airDate ?? "—"}</td>
              <td className="px-3 py-2">
                <EpisodeStatusPill status={e.status} />
              </td>
              <td className="px-3 py-2 text-right">
                <div className="inline-flex items-center gap-1">
                  <button
                    onClick={() => onSearchEpisode(e.number)}
                    title="Search interactive"
                    className="p-1 rounded hover:bg-white/5 text-muted"
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onGrabEpisode(e.number)}
                    disabled={e.status === "unaired" || e.status === "downloaded"}
                    title="Grab"
                    className="p-1 rounded hover:bg-accent/15 text-accent disabled:opacity-30"
                  >
                    <Zap className="w-3.5 h-3.5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EpisodeStatusPill({ status }: { status: string }) {
  const cfg: Record<string, { color: string; icon?: any; label: string }> = {
    downloaded: { color: "text-emerald-400", icon: Check, label: "Downloaded" },
    wanted: { color: "text-amber-400", icon: AlertCircle, label: "Wanted" },
    snatched: { color: "text-blue-400", icon: Loader2, label: "Snatched" },
    downloading: { color: "text-blue-400", icon: Loader2, label: "Downloading" },
    unaired: { color: "text-zinc-500", icon: Clock, label: "Unaired" },
    missing: { color: "text-rose-400", icon: AlertCircle, label: "Missing" },
    unmonitored: { color: "text-muted/50", label: "Unmonitored" },
  };
  const c = cfg[status] ?? { color: "text-muted", label: status };
  const Icon = c.icon;
  return (
    <span className={`inline-flex items-center gap-1 ${c.color}`}>
      {Icon && <Icon className={`w-3 h-3 ${status === "downloading" || status === "snatched" ? "animate-spin" : ""}`} />}
      {c.label}
    </span>
  );
}
