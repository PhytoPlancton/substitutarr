"use client";
import { use, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Search,
  Zap,
  Loader2,
  Trash2,
  RefreshCcw,
  Link2,
  ExternalLink,
  Play,
  Check,
  AlertCircle,
} from "lucide-react";
import { SearchModal } from "@/components/SearchModal";

type Episode = { number: number; status: string };
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
  status?: string;
  tmdbStatus?: string;
  nextAirDate?: string;
  seasons?: Season[];
};
type Cast = { id: number; name: string; character: string; profile?: string | null };
type Extras = {
  cast: Cast[];
  director?: string;
  writers: string[];
  trailerKey?: string;
  externalIds: { imdbId?: string; tvdbId?: number };
  similar: { tmdbId: number; type: "movie" | "tv"; title: string; year?: number; poster?: string | null }[];
  collection?: {
    id: number;
    name: string;
    backdrop?: string | null;
    movies: { tmdbId: number; title: string; year?: number; poster?: string | null }[];
  };
};
type Activity = {
  _id: string;
  kind: string;
  title?: string;
  detail?: string;
  season?: number;
  episode?: number;
  indexer?: string;
  at: string;
};
type Download = { mediaId: string; progress?: number; state?: string; title?: string; quality?: string; sizeBytes?: number };

export default function MediaDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [explainCtx, setExplainCtx] = useState<{ open: boolean; season?: number; episode?: number }>({ open: false });
  const [trailerOpen, setTrailerOpen] = useState(false);

  const { data, isLoading } = useQuery<{ item: Media }>({
    queryKey: ["library", id],
    queryFn: async () => (await fetch(`/api/library/${id}`)).json(),
    refetchInterval: 5000,
  });
  const { data: extrasData } = useQuery<{ extras?: Extras; activity?: Activity[] }>({
    queryKey: ["library-extras", id],
    queryFn: async () => (await fetch(`/api/library/${id}/extras`)).json(),
  });
  const { data: dlData } = useQuery<{ items: Download[] }>({
    queryKey: ["downloads"],
    queryFn: async () => (await fetch("/api/downloads")).json(),
    refetchInterval: 5000,
  });

  const grab = useMutation({
    mutationFn: async () => fetch(`/api/grab`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mediaId: id }),
    }).then((r) => r.json()),
    onSuccess: (r) => {
      if (!r.ok) alert(`Grab failed:\n${r.error ?? "unknown"}`);
      qc.invalidateQueries({ queryKey: ["library", id] });
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });

  const grabSeason = useMutation({
    mutationFn: async ({ s, ep }: { s: number; ep?: number }) => {
      const qs = ep != null ? `?episode=${ep}` : "";
      return fetch(`/api/library/${id}/season/${s}/grab${qs}`, { method: "POST" }).then((r) => r.json());
    },
    onSuccess: (r) => {
      if (!r.ok) alert(`Grab failed:\n${r.error ?? "unknown"}`);
      qc.invalidateQueries({ queryKey: ["library", id] });
      qc.invalidateQueries({ queryKey: ["downloads"] });
    },
  });

  const remove = useMutation({
    mutationFn: async () => fetch(`/api/library/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => { window.location.href = "/library"; },
  });

  const refresh = useMutation({
    mutationFn: async () => fetch(`/api/library/${id}/refresh`, { method: "POST" }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library", id] });
      qc.invalidateQueries({ queryKey: ["library-extras", id] });
    },
  });

  // Auto-refresh once if the persisted seasons are missing names or posters
  // (entries added before the schema upgrade).
  const needsRefresh =
    data?.item?.type === "tv" &&
    !!data.item.seasons?.some((s) => s.number > 0 && (!s.name || !s.posterUrl)) &&
    !refresh.isPending &&
    !refresh.data;
  useEffect(() => {
    if (needsRefresh) refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRefresh]);

  if (isLoading || !data?.item) return <div className="text-muted">Loading…</div>;
  const m = data.item;
  const isTv = m.type === "tv";
  const seasons = (m.seasons ?? []).filter((s) => s.number > 0);
  const stats = isTv ? computeTvStats(m.seasons ?? []) : null;
  const myDownload = (dlData?.items ?? []).find((d) => d.mediaId === id);

  return (
    <div className="space-y-8">
      {/* Back link */}
      <div>
        <Link
          href="/library"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-white"
        >
          <ArrowLeft className="w-4 h-4" /> Library
        </Link>
      </div>

      <Hero
        media={m}
        stats={stats}
        myDownload={myDownload}
        extras={extrasData?.extras}
        onGrab={() => grab.mutate()}
        grabbing={grab.isPending}
        onSearch={() => setExplainCtx({ open: true })}
        onTrailer={() => setTrailerOpen(true)}
        onRemove={() => confirm(`Remove "${m.title}"?`) && remove.mutate()}
      />

      {/* Synopsis + external links */}
      {(m.overview || extrasData?.extras?.externalIds || extrasData?.extras?.trailerKey) && (
        <section className="space-y-3">
          {m.overview && <Synopsis text={m.overview} />}
          <ExternalLinks
            tmdbId={(m as any).tmdbId}
            type={m.type}
            imdbId={extrasData?.extras?.externalIds.imdbId}
            trailerKey={extrasData?.extras?.trailerKey}
            onTrailer={() => setTrailerOpen(true)}
          />
        </section>
      )}

      {/* TV: Seasons grid */}
      {isTv && seasons.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm uppercase tracking-wider text-muted">
              Seasons {refresh.isPending && <Loader2 className="inline w-3 h-3 animate-spin ml-1" />}
            </h2>
            <button
              onClick={() => refresh.mutate()}
              disabled={refresh.isPending}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-white"
              title="Refresh from TMDB"
            >
              <RefreshCcw className={`w-3 h-3 ${refresh.isPending ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
            {seasons.map((s) => (
              <SeasonCard
                key={s.number}
                mediaId={id}
                season={s}
                onGrabPack={() => grabSeason.mutate({ s: s.number })}
                grabbing={grabSeason.isPending && grabSeason.variables?.s === s.number && grabSeason.variables?.ep == null}
              />
            ))}
          </div>
        </section>
      )}

      {/* Movie: file details */}
      {!isTv && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted">File</h2>
          <MovieFileBlock media={m} download={myDownload} />
        </section>
      )}

      {/* Cast — wraps on small screens */}
      {extrasData?.extras?.cast && extrasData.extras.cast.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted">Cast</h2>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-3">
            {extrasData.extras.cast.slice(0, 10).map((c) => (
              <div key={c.id} className="text-center" title={c.character}>
                <div className="relative w-14 h-14 sm:w-16 sm:h-16 rounded-full overflow-hidden mx-auto bg-bg/40">
                  {c.profile ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.profile} alt={c.name} className="absolute inset-0 w-full h-full object-cover" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted text-lg">{c.name[0]}</div>
                  )}
                </div>
                <div className="mt-1 text-[11px] truncate">{c.name}</div>
                <div className="text-[10px] text-muted truncate">{c.character}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Crew (movies — director + writers) */}
      {!isTv && (extrasData?.extras?.director || extrasData?.extras?.writers.length) && (
        <section className="text-xs text-muted">
          {extrasData?.extras?.director && (
            <span>Director: <span className="text-white">{extrasData.extras.director}</span></span>
          )}
          {extrasData?.extras?.writers && extrasData.extras.writers.length > 0 && (
            <span className="ml-3">Writers: <span className="text-white">{extrasData.extras.writers.join(", ")}</span></span>
          )}
        </section>
      )}

      {/* Activity log */}
      {extrasData?.activity && extrasData.activity.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted">Activity</h2>
          <ul className="bg-surface border border-border rounded-lg divide-y divide-border">
            {extrasData.activity.slice(0, 8).map((a) => (
              <li key={a._id} className="px-4 py-2 text-xs flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <ActivityIcon kind={a.kind} />
                    <span className="font-medium capitalize">{a.kind}</span>
                    {a.season != null && (
                      <span className="text-muted font-mono">
                        S{String(a.season).padStart(2, "0")}{a.episode != null ? `E${String(a.episode).padStart(2, "0")}` : ""}
                      </span>
                    )}
                    {a.indexer && <span className="text-muted">via {a.indexer}</span>}
                  </div>
                  {a.title && <div className="text-muted truncate mt-0.5">{a.title}</div>}
                </div>
                <span className="text-muted/70 shrink-0">{relTime(a.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Movie collection — capped grid */}
      {!isTv && extrasData?.extras?.collection && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted">{extrasData.extras.collection.name}</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-3">
            {extrasData.extras.collection.movies.slice(0, 16).map((mv) => (
              <PosterTile key={mv.tmdbId} title={mv.title} year={mv.year} poster={mv.poster} />
            ))}
          </div>
        </section>
      )}

      {/* Similar — capped at 6 visible items */}
      {extrasData?.extras?.similar && extrasData.extras.similar.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted">Similar</h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
            {extrasData.extras.similar.slice(0, 6).map((sim) => (
              <PosterTile key={sim.tmdbId} title={sim.title} year={sim.year} poster={sim.poster} />
            ))}
          </div>
        </section>
      )}

      {trailerOpen && extrasData?.extras?.trailerKey && (
        <div
          onClick={() => setTrailerOpen(false)}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-4xl aspect-video">
            <iframe
              src={`https://www.youtube.com/embed/${extrasData.extras.trailerKey}?autoplay=1`}
              allow="autoplay; fullscreen"
              className="w-full h-full rounded-lg"
            />
          </div>
        </div>
      )}

      {explainCtx.open && (
        <SearchModal
          mediaId={id}
          mediaTitle={`${m.title}${
            explainCtx.season != null
              ? ` · S${String(explainCtx.season).padStart(2, "0")}${
                  explainCtx.episode != null ? `E${String(explainCtx.episode).padStart(2, "0")}` : ""
                }`
              : ""
          }`}
          onClose={() => setExplainCtx({ open: false })}
        />
      )}
    </div>
  );
}

function Hero({
  media,
  stats,
  extras,
  myDownload,
  onGrab,
  grabbing,
  onSearch,
  onTrailer,
  onRemove,
}: {
  media: Media;
  stats: ReturnType<typeof computeTvStats> | null;
  extras?: Extras;
  myDownload?: Download;
  onGrab: () => void;
  grabbing: boolean;
  onSearch: () => void;
  onTrailer: () => void;
  onRemove: () => void;
}) {
  const isTv = media.type === "tv";
  return (
    <section className="relative rounded-lg overflow-hidden border border-border" style={{ minHeight: 320 }}>
      {media.backdrop && (
        <div className="absolute inset-0 -z-0">
          <Image src={media.backdrop} alt="" fill className="object-cover scale-110" priority />
          <div className="absolute inset-0 bg-bg/60 backdrop-blur-sm" />
          <div className="absolute inset-0 bg-gradient-to-t from-bg via-bg/70 to-transparent" />
        </div>
      )}
      <div className="relative z-10 p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-6">
        {media.poster && (
          <div className="relative aspect-[2/3] w-44 sm:w-44 rounded-md overflow-hidden ring-1 ring-white/10 shadow-2xl">
            <Image src={media.poster} alt={media.title} fill className="object-cover" />
          </div>
        )}
        <div className="flex flex-col justify-end gap-3 min-w-0">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {isTv && media.tmdbStatus && (
              <span className={`inline-flex items-center gap-1 ${tmdbStatusColor(media.tmdbStatus)}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tmdbDotBg(media.tmdbStatus)}`} />
                {tmdbStatusLabel(media.tmdbStatus)}
              </span>
            )}
            <span className="text-muted">{media.year ?? "—"}</span>
            {isTv && stats && (
              <>
                <span className="text-muted">·</span>
                <span className="text-muted">
                  {stats.seasonCount} season{stats.seasonCount > 1 ? "s" : ""}
                </span>
                <span className="text-muted">·</span>
                <span className="text-muted">{stats.aired} aired ep</span>
              </>
            )}
            {!isTv && myDownload?.quality && (
              <>
                <span className="text-muted">·</span>
                <span className="text-emerald-400">✓ {myDownload.quality}</span>
              </>
            )}
          </div>

          <h1 className="text-3xl font-semibold tracking-tight">{media.title}</h1>

          {isTv && stats && (
            <div className="text-sm text-muted">
              <strong className="text-white">{stats.downloaded}</strong>/{stats.aired || 0} downloaded
              {media.nextAirDate && (
                <span className="ml-3 text-amber-400">Next: {media.nextAirDate}</span>
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap pt-2">
            {!isTv && (
              <button
                onClick={onGrab}
                disabled={grabbing || media.status === "downloaded" || media.status === "downloading"}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50"
              >
                {grabbing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Auto-grab
              </button>
            )}
            <button
              onClick={onSearch}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-accent/15 text-accent hover:bg-accent/25"
            >
              <Search className="w-4 h-4" /> Search & explain
            </button>
            {extras?.trailerKey && (
              <button
                onClick={onTrailer}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm border border-border hover:bg-white/5"
              >
                <Play className="w-4 h-4" /> Trailer
              </button>
            )}
            <button
              onClick={onRemove}
              title="Remove"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-sm border border-border hover:bg-rose-500/15 text-rose-400"
            >
              <Trash2 className="w-4 h-4" /> Remove
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Synopsis({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280;
  return (
    <div className="text-sm text-muted/90">
      <p className={open || !long ? "" : "line-clamp-3"}>{text}</p>
      {long && (
        <button
          onClick={() => setOpen((v) => !v)}
          className="text-accent text-xs mt-1 hover:underline"
        >
          {open ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function ExternalLinks({
  tmdbId,
  type,
  imdbId,
  trailerKey,
  onTrailer,
}: {
  tmdbId: number;
  type: "movie" | "tv";
  imdbId?: string;
  trailerKey?: string;
  onTrailer: () => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap text-xs">
      <a
        href={`https://www.themoviedb.org/${type}/${tmdbId}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-white/5"
      >
        TMDB <ExternalLink className="w-3 h-3" />
      </a>
      {imdbId && (
        <a
          href={`https://www.imdb.com/title/${imdbId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-white/5"
        >
          IMDb <ExternalLink className="w-3 h-3" />
        </a>
      )}
      <a
        href={`https://trakt.tv/search/tmdb/${tmdbId}?id_type=${type}`}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-white/5"
      >
        Trakt <ExternalLink className="w-3 h-3" />
      </a>
      {trailerKey && (
        <button
          onClick={onTrailer}
          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-white/5"
        >
          <Play className="w-3 h-3" /> Trailer
        </button>
      )}
    </div>
  );
}

function SeasonCard({
  mediaId,
  season,
  onGrabPack,
  grabbing,
}: {
  mediaId: string;
  season: Season;
  onGrabPack: () => void;
  grabbing: boolean;
}) {
  const eps = season.episodes;
  const total = eps.length;
  const dl = eps.filter((e) => e.status === "downloaded").length;
  const aired = eps.filter((e) => e.status !== "unaired").length;
  const pct = total ? Math.round((dl / total) * 100) : 0;

  let ringColor = "ring-zinc-800";
  if (!season.monitored) ringColor = "ring-zinc-800 opacity-60";
  else if (aired === 0) ringColor = "ring-zinc-700";
  else if (dl === aired) ringColor = "ring-emerald-500/40";
  else if (dl > 0) ringColor = "ring-accent/40";
  else ringColor = "ring-amber-500/40";

  return (
    <div
      className={`rounded-lg ring-1 ${ringColor} bg-surface overflow-hidden hover:ring-2 transition-all`}
    >
      <Link href={`/library/${mediaId}/season/${season.number}`}>
        <div className="relative aspect-[2/3] bg-bg/40">
          {season.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={season.posterUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
          ) : null}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 to-transparent p-2">
            <div className="text-xs font-medium">
              {season.name ?? `Season ${season.number}`}
            </div>
            <div className="text-[10px] text-muted">
              {dl}/{aired || 0} ep
            </div>
            <div className="h-0.5 mt-1 bg-white/10 rounded overflow-hidden">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
            </div>
          </div>
        </div>
      </Link>
      <button
        onClick={onGrabPack}
        disabled={grabbing}
        className="w-full px-2 py-1.5 text-[10px] text-accent hover:bg-accent/10 inline-flex items-center justify-center gap-1 disabled:opacity-50"
      >
        {grabbing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
        Grab pack
      </button>
    </div>
  );
}

function PosterTile({
  title,
  year,
  poster,
}: {
  title: string;
  year?: number | string;
  poster?: string | null;
}) {
  return (
    <div>
      <div className="relative aspect-[2/3] rounded-md overflow-hidden bg-bg/40 ring-1 ring-white/5">
        {poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt={title} className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted p-2 text-center">
            {title}
          </div>
        )}
      </div>
      <div className="mt-1 text-[11px] truncate">{title}</div>
      <div className="text-[10px] text-muted">{year}</div>
    </div>
  );
}

function MovieFileBlock({ media, download }: { media: Media; download?: Download }) {
  const has = media.status === "downloaded" || download?.state === "completed";
  if (!has) {
    return (
      <div className="bg-surface border border-border rounded-lg p-5 text-sm text-muted">
        No file yet. Use Auto-grab or Search & explain to fetch this movie.
      </div>
    );
  }
  return (
    <div className="bg-surface border border-border rounded-lg p-5 space-y-2 text-sm">
      <div className="font-mono text-xs break-all">{download?.title ?? "—"}</div>
      <div className="flex items-center gap-3 text-xs text-muted flex-wrap">
        {download?.quality && <span className="text-emerald-400">✓ {download.quality}</span>}
        {download?.sizeBytes && <span>{(download.sizeBytes / 1e9).toFixed(2)} GB</span>}
        {download?.state && <span>state: {download.state}</span>}
      </div>
    </div>
  );
}

function ActivityIcon({ kind }: { kind: string }) {
  if (kind === "grabbed") return <Zap className="w-3 h-3 text-accent" />;
  if (kind === "imported") return <Check className="w-3 h-3 text-emerald-400" />;
  if (kind === "upgraded") return <RefreshCcw className="w-3 h-3 text-blue-400" />;
  if (kind === "failed") return <AlertCircle className="w-3 h-3 text-rose-400" />;
  return <Link2 className="w-3 h-3 text-muted" />;
}

function relTime(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}

function computeTvStats(seasons: Season[]) {
  const real = seasons.filter((s) => s.number > 0);
  let total = 0,
    downloaded = 0,
    aired = 0,
    monitored = 0;
  for (const s of real) {
    if (s.monitored) monitored++;
    for (const e of s.episodes ?? []) {
      total++;
      if (e.status === "downloaded") downloaded++;
      if (e.status !== "unaired") aired++;
    }
  }
  return { seasonCount: real.length, monitoredSeasons: monitored, total, downloaded, aired };
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
function tmdbDotBg(s?: string): string {
  switch (s) {
    case "returning_series":
    case "in_production":
      return "bg-emerald-500";
    case "ended":
      return "bg-zinc-500";
    case "canceled":
      return "bg-rose-500";
    default:
      return "bg-zinc-500";
  }
}
