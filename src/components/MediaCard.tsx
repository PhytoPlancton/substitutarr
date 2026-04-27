"use client";
import Image from "next/image";
import { Film, Tv as TvIcon } from "lucide-react";

type Props = {
  poster?: string | null;
  title: string;
  year?: number | string;
  type: "movie" | "tv";
  status?: string;
  onClick?: () => void;
  rightSlot?: React.ReactNode;
};

const STATUS_COLORS: Record<string, string> = {
  wanted: "bg-amber-500/15 text-amber-400",
  downloading: "bg-blue-500/15 text-blue-400",
  downloaded: "bg-emerald-500/15 text-emerald-400",
  missing: "bg-rose-500/15 text-rose-400",
  paused: "bg-zinc-500/15 text-zinc-400",
};

export function MediaCard({ poster, title, year, type, status, onClick, rightSlot }: Props) {
  return (
    <div
      onClick={onClick}
      className="group bg-surface border border-border rounded-lg overflow-hidden cursor-pointer hover:border-accent/60 transition-colors"
    >
      <div className="relative aspect-[2/3] bg-black/30">
        {poster ? (
          <Image src={poster} alt={title} fill sizes="(max-width:640px) 50vw, 200px" className="object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted">
            {type === "movie" ? <Film className="w-10 h-10" /> : <TvIcon className="w-10 h-10" />}
          </div>
        )}
        {status && (
          <span
            className={`absolute top-2 right-2 px-2 py-0.5 text-xs rounded ${STATUS_COLORS[status] ?? "bg-white/10"}`}
          >
            {status}
          </span>
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
