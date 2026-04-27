"use client";
import Image from "next/image";
import { Film, Tv as TvIcon, Check, AlertCircle, Pause } from "lucide-react";

type Props = {
  poster?: string | null;
  title: string;
  year?: number | string;
  type: "movie" | "tv";
  status?: string;
  /** 0..1 — when set on a `downloading` item, renders a thin progress bar at the
   *  bottom of the poster. */
  progress?: number;
  onClick?: () => void;
  rightSlot?: React.ReactNode;
};

const STATUS_BORDER: Record<string, string> = {
  wanted: "border-l-amber-500/60",
  downloading: "border-l-blue-500/60",
  downloaded: "border-l-emerald-500/60",
  missing: "border-l-rose-500/60",
  paused: "border-l-zinc-500/40",
};

export function MediaCard({ poster, title, year, type, status, progress, onClick, rightSlot }: Props) {
  const borderClass = status ? STATUS_BORDER[status] ?? "" : "";
  return (
    <div
      onClick={onClick}
      className={`group bg-surface border border-border ${borderClass ? `border-l-2 ${borderClass}` : ""} rounded-lg overflow-hidden cursor-pointer hover:border-accent/60 transition-colors`}
    >
      <div className="relative aspect-[2/3] bg-black/30">
        {poster ? (
          <Image src={poster} alt={title} fill sizes="(max-width:640px) 50vw, 200px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            {type === "movie" ? <Film className="w-10 h-10" /> : <TvIcon className="w-10 h-10" />}
          </div>
        )}

        {/* Coin badge — discrete corner indicator instead of full-poster tint */}
        {status === "downloaded" && (
          <div
            title="downloaded"
            className="absolute top-2 right-2 rounded-full bg-emerald-500/95 p-1 shadow"
          >
            <Check className="h-3.5 w-3.5 text-white" />
          </div>
        )}
        {status === "missing" && (
          <div
            title="missing"
            className="absolute top-2 right-2 rounded-full bg-rose-500/95 p-1 shadow"
          >
            <AlertCircle className="h-3.5 w-3.5 text-white" />
          </div>
        )}
        {status === "paused" && (
          <div
            title="paused"
            className="absolute top-2 right-2 rounded-full bg-zinc-600/95 p-1 shadow"
          >
            <Pause className="h-3.5 w-3.5 text-white" />
          </div>
        )}
        {status === "downloading" && (
          <div
            title={`downloading${typeof progress === "number" ? ` · ${Math.round(progress * 100)}%` : ""}`}
            className="absolute top-2 right-2 rounded-full bg-blue-500/95 px-1.5 py-0.5 text-[10px] font-medium text-white shadow"
          >
            {typeof progress === "number" ? `${Math.round(progress * 100)}%` : "DL"}
          </div>
        )}

        {/* Mini progress bar at the bottom edge — Sonarr style */}
        {status === "downloading" && typeof progress === "number" && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
            <div
              className="h-full bg-blue-500 transition-[width]"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-medium text-sm truncate">{title}</h3>
            <p className="text-xs text-muted">
              {year ?? "—"} · {type === "movie" ? "Movie" : "TV"}
            </p>
          </div>
          {rightSlot}
        </div>
      </div>
    </div>
  );
}
