"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Film, Tv, Download, Search, Check, Circle } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

type Stats = { movies: number; tv: number; downloading: number; missing: number };

export default function DashboardPage() {
  const t = useT();
  const { data } = useQuery<{ items: any[] }>({
    queryKey: ["library"],
    queryFn: async () => (await fetch("/api/library")).json(),
  });
  const { data: dl } = useQuery<{ items: any[] }>({
    queryKey: ["downloads"],
    queryFn: async () => (await fetch("/api/downloads")).json(),
    refetchInterval: 5000,
  });
  const { data: settings } = useQuery<{ settings: any }>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch("/api/settings")).json(),
  });
  const { data: indexers } = useQuery<{ items: any[] }>({
    queryKey: ["indexers"],
    queryFn: async () => (await fetch("/api/indexers")).json(),
  });

  const stats: Stats = {
    movies: data?.items?.filter((i) => i.type === "movie").length ?? 0,
    tv: data?.items?.filter((i) => i.type === "tv").length ?? 0,
    downloading: dl?.items?.filter((i) => i.state === "downloading").length ?? 0,
    missing: data?.items?.filter((i) => i.status === "missing" || i.status === "wanted").length ?? 0,
  };

  // Steps progressively checked off as the user completes setup.
  // The whole block hides once everything is done.
  const qbitConfigured = !!(settings?.settings?.qbittorrent?.url || process.env.NEXT_PUBLIC_QBIT_FALLBACK);
  const hasIndexer = (indexers?.items ?? []).filter((i) => i.enabled !== false).length > 0;
  const hasLibrary = (data?.items?.length ?? 0) > 0;
  const allDone = qbitConfigured && hasIndexer && hasLibrary;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("dashboard.title")}</h1>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat icon={Film} label={t("dashboard.statsMovies")} value={stats.movies} />
        <Stat icon={Tv} label={t("dashboard.statsTv")} value={stats.tv} />
        <Stat icon={Download} label={t("dashboard.statsDownloading")} value={stats.downloading} />
        <Stat icon={Search} label={t("dashboard.statsWanted")} value={stats.missing} />
      </div>

      {!allDone && (
        <section className="bg-surface border border-border rounded-lg p-6">
          <h2 className="text-sm uppercase tracking-wider text-muted mb-3">
            {t("dashboard.getStarted")}
          </h2>
          <ol className="space-y-2 text-sm">
            <Step
              done={qbitConfigured && hasIndexer}
              label={
                <>
                  {t("dashboard.step1Pre")}
                  <Link className="text-accent hover:underline" href="/settings">
                    {t("dashboard.step1Action")}
                  </Link>
                  {t("dashboard.step1Post")}
                </>
              }
            />
            <Step
              done={hasLibrary}
              label={
                <>
                  {t("dashboard.step2Pre")}
                  <Link className="text-accent hover:underline" href="/search">
                    {t("dashboard.step2Action")}
                  </Link>
                  {t("dashboard.step2Post")}
                </>
              }
            />
            <Step done={false} dim label={t("dashboard.step3")} />
          </ol>
        </section>
      )}
    </div>
  );
}

function Step({ done, dim, label }: { done: boolean; dim?: boolean; label: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      {done ? (
        <Check className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" />
      ) : (
        <Circle className="w-4 h-4 mt-0.5 text-muted shrink-0" />
      )}
      <span className={done ? "line-through text-muted" : dim ? "text-muted" : ""}>{label}</span>
    </li>
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
