"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

type Dl = {
  _id: string;
  title: string;
  state: string;
  qbState?: string;
  progress: number;
  sizeBytes?: number;
  dlspeed?: number;
  eta?: number;
  indexer?: string;
  quality?: string;
};

const fmtBytes = (b?: number) => {
  if (!b) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) {
    b /= 1024;
    i++;
  }
  return `${b.toFixed(1)} ${u[i]}`;
};
const fmtEta = (s?: number) => {
  if (!s || s === 8640000) return "—";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
};

export default function DownloadsPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery<{ items: Dl[] }>({
    queryKey: ["downloads"],
    queryFn: async () => (await fetch("/api/downloads")).json(),
    refetchInterval: 3000,
  });

  const remove = useMutation({
    mutationFn: async ({ id, files }: { id: string; files: boolean }) =>
      fetch(`/api/downloads/${id}?files=${files ? 1 : 0}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downloads"] }),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t("downloads.title")}</h1>
        <p className="text-muted text-sm">{t("downloads.subtitle")}</p>
      </header>

      {items.length === 0 ? (
        <div className="bg-surface border border-border rounded-lg p-10 text-center text-muted">
          {t("downloads.empty")}
        </div>
      ) : (
        <div className="bg-surface border border-border rounded-lg divide-y divide-border">
          {items.map((d) => (
            <div key={d._id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{d.title}</div>
                  <div className="text-xs text-muted mt-0.5">
                    {d.indexer} · {d.quality ?? "?"} · {fmtBytes(d.sizeBytes)}
                  </div>
                </div>
                <div className="text-right text-xs text-muted whitespace-nowrap">
                  {d.qbState ?? d.state} · {fmtBytes(d.dlspeed)}/s · ETA {fmtEta(d.eta)}
                </div>
                <button
                  onClick={() =>
                    confirm(t("downloads.removeConfirm", { title: d.title }))
                      ? remove.mutate({ id: d._id, files: true })
                      : remove.mutate({ id: d._id, files: false })
                  }
                  className="p-1 rounded hover:bg-rose-500/15 text-rose-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mt-2 h-1.5 bg-black/40 rounded overflow-hidden">
                <div
                  className="h-full bg-accent transition-[width]"
                  style={{ width: `${Math.round((d.progress ?? 0) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
