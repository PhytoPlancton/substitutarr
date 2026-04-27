"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Film, Tv, Download, Search } from "lucide-react";

type Stats = { movies: number; tv: number; downloading: number; missing: number };

export default function DashboardPage() {
  const { data } = useQuery<{ items: any[] }>({
    queryKey: ["library"],
    queryFn: async () => (await fetch("/api/library")).json(),
  });
  const { data: dl } = useQuery<{ items: any[] }>({
    queryKey: ["downloads"],
    queryFn: async () => (await fetch("/api/downloads")).json(),
    refetchInterval: 5000,
  });

  const stats: Stats = {
    movies: data?.items?.filter((i) => i.type === "movie").length ?? 0,
    tv: data?.items?.filter((i) => i.type === "tv").length ?? 0,
    downloading: dl?.items?.filter((i) => i.state === "downloading").length ?? 0,
    missing: data?.items?.filter((i) => i.status === "missing" || i.status === "wanted").length ?? 0,
  };

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted text-sm">Une seule app, zéro container en plus.</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat icon={Film} label="Movies" value={stats.movies} />
        <Stat icon={Tv} label="TV Shows" value={stats.tv} />
        <Stat icon={Download} label="Downloading" value={stats.downloading} />
        <Stat icon={Search} label="Wanted" value={stats.missing} />
      </div>

      <section className="bg-surface border border-border rounded-lg p-6">
        <h2 className="text-sm uppercase tracking-wider text-muted mb-3">Get started</h2>
        <ol className="space-y-2 text-sm">
          <li>
            1. <Link className="text-accent hover:underline" href="/settings">Configure</Link> qBittorrent + Jellyfin + indexers.
          </li>
          <li>
            2. <Link className="text-accent hover:underline" href="/search">Search</Link> a movie or show, add it to your library.
          </li>
          <li>3. substitutarr auto-grabs the best release every 10 minutes.</li>
        </ol>
      </section>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 text-muted text-xs uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" />
        {label}
      </div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
    </div>
  );
}
