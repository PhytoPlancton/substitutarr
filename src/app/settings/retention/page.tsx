"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, AlertTriangle, Loader2, Check, CircleX, PlayCircle, ShieldOff, Star } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

type Mode = "off" | "dry_run" | "active";

type RetentionSettings = {
  mode: Mode;
  activatedAt: string | null;
  dryRunStartedAt: string | null;
  thresholds: {
    notWatchedSinceImportDays: number;
    watchedLongAgoDays: number;
    tvEndedBingedDays: number;
    diskPressurePercent: number;
  };
  maxDeletionsPerDay: number;
  preDeleteNoticeHours: number;
  lastRunAt: string | null;
  lastRunSummary?: {
    candidates: number;
    deleted: number;
    bytesFreed: number;
    skippedReason?: string;
  };
};

type Candidate = {
  mediaId: string;
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  year?: number;
  reason: string;
  detail: string;
  sizeBytes: number;
  lastPlayedDate?: string;
  addedAt: string;
};

type PreviewResp = {
  jellyfinHealthy: boolean;
  diskPercent: number | null;
  diskPressureActive: boolean;
  skippedReason?: string;
  totalBytes: number;
  candidates: Candidate[];
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(0)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function RetentionPage() {
  const t = useT();
  const qc = useQueryClient();
  const [form, setForm] = useState<RetentionSettings | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  const { data: settings } = useQuery<{ settings: any }>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch("/api/settings")).json(),
  });
  const { data: preview, refetch: refetchPreview, isFetching: previewLoading } = useQuery<PreviewResp>({
    queryKey: ["retention-preview"],
    queryFn: async () => (await fetch("/api/retention/preview")).json(),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const r = settings?.settings?.retention;
    if (r) setForm(r);
  }, [settings]);

  const patch = useMutation({
    mutationFn: async (patch: {
      mode?: Mode;
      thresholds?: Partial<RetentionSettings["thresholds"]>;
      maxDeletionsPerDay?: number;
      preDeleteNoticeHours?: number;
    }) => {
      const res = await fetch("/api/settings/retention", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      return data;
    },
    onSuccess: () => {
      setTransitionError(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
    onError: (e: any) => setTransitionError(e.message),
  });

  const exclude = useMutation({
    mutationFn: async (mediaId: string) => {
      const res = await fetch("/api/retention/exclude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId, months: 6 }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "failed");
    },
    onSuccess: () => refetchPreview(),
  });

  if (!form) return <div className="p-8 text-muted text-sm">Loading…</div>;

  const dryRunDaysElapsed = form.dryRunStartedAt
    ? Math.floor((Date.now() - new Date(form.dryRunStartedAt).getTime()) / 86400_000)
    : 0;
  const dryRunReady = form.dryRunStartedAt && dryRunDaysElapsed >= 7;

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Trash2 className="w-5 h-5 text-accent" />
          {t("retention.title")}
        </h1>
        <p className="text-sm text-muted mt-1">{t("retention.subtitle")}</p>
      </header>

      {/* Mode selector */}
      <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div>
          <div className="text-xs uppercase text-muted/70 mb-2">{t("retention.modeLabel")}</div>
          <div className="grid grid-cols-3 gap-2">
            {(["off", "dry_run", "active"] as Mode[]).map((m) => {
              const isActive = form.mode === m;
              const isDisabledActive = m === "active" && form.mode === "off"; // can't jump from off
              const isDryRunTooEarly = m === "active" && form.mode === "dry_run" && !dryRunReady;
              const disabled = isDisabledActive || isDryRunTooEarly;
              return (
                <button
                  key={m}
                  disabled={disabled}
                  onClick={() => patch.mutate({ mode: m })}
                  className={`px-3 py-3 rounded-md text-sm font-medium border transition-colors ${
                    isActive
                      ? m === "active"
                        ? "bg-rose-500/15 border-rose-500/50 text-rose-300"
                        : m === "dry_run"
                          ? "bg-amber-500/15 border-amber-500/50 text-amber-300"
                          : "bg-white/5 border-border text-muted"
                      : disabled
                        ? "border-border text-muted/40 cursor-not-allowed"
                        : "border-border text-muted hover:text-white hover:bg-white/5"
                  }`}
                >
                  {t(`retention.mode.${m}`)}
                </button>
              );
            })}
          </div>
          {transitionError && (
            <div className="mt-2 text-xs text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {transitionError}
            </div>
          )}
          {form.mode === "dry_run" && !dryRunReady && (
            <div className="mt-2 text-xs text-amber-400 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5" />
              {t("retention.dryRunRemaining", { days: String(7 - dryRunDaysElapsed) })}
            </div>
          )}
          {form.mode === "active" && (
            <div className="mt-2 text-xs text-rose-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t("retention.activeWarning", { hours: String(form.preDeleteNoticeHours) })}
            </div>
          )}
        </div>
      </div>

      {/* Thresholds */}
      <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="text-xs uppercase text-muted/70">{t("retention.thresholdsLabel")}</div>
        {([
          { key: "notWatchedSinceImportDays", icon: PlayCircle, suffix: t("retention.suffixDays") },
          { key: "watchedLongAgoDays", icon: PlayCircle, suffix: t("retention.suffixDays") },
          { key: "tvEndedBingedDays", icon: PlayCircle, suffix: t("retention.suffixDays") },
          { key: "diskPressurePercent", icon: AlertTriangle, suffix: "%" },
        ] as const).map(({ key, icon: Icon, suffix }) => (
          <div key={key} className="flex items-center gap-3">
            <Icon className="w-4 h-4 text-muted" />
            <label className="text-sm flex-1">{t(`retention.threshold.${key}`)}</label>
            <input
              type="number"
              value={form.thresholds[key]}
              onChange={(e) =>
                setForm((f) =>
                  f ? { ...f, thresholds: { ...f.thresholds, [key]: Number(e.target.value) || 0 } } : f,
                )
              }
              onBlur={() => patch.mutate({ thresholds: { [key]: form.thresholds[key] } })}
              className="w-20 bg-bg border border-border rounded-md px-2 py-1 text-sm text-right font-mono"
            />
            <span className="text-xs text-muted w-8">{suffix}</span>
          </div>
        ))}

        <div className="pt-3 border-t border-border flex items-center gap-2 text-xs text-muted">
          <Star className="w-3.5 h-3.5 text-amber-400" />
          {t("retention.favoritesAlwaysKept")}
        </div>
      </div>

      {/* Last run + preview */}
      <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase text-muted/70">{t("retention.previewLabel")}</div>
            {form.lastRunAt && (
              <div className="text-xs text-muted mt-1">
                {t("retention.lastRun", { date: new Date(form.lastRunAt).toLocaleString() })}
              </div>
            )}
          </div>
          <button
            onClick={() => refetchPreview()}
            disabled={previewLoading}
            className="px-3 py-1.5 rounded-md border border-border text-sm hover:bg-white/5 flex items-center gap-2"
          >
            {previewLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            {t("retention.runDryRun")}
          </button>
        </div>

        {preview?.skippedReason && (
          <div className="text-sm text-amber-400 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{t("retention.skipped", { reason: preview.skippedReason })}</span>
          </div>
        )}

        {preview && !preview.skippedReason && (
          <>
            <div className="flex items-center gap-4 text-sm">
              <span>
                <strong>{preview.candidates.length}</strong> {t("retention.candidatesCount")}
              </span>
              <span className="text-muted">·</span>
              <span>
                {formatBytes(preview.totalBytes)} {t("retention.couldFree")}
              </span>
              {preview.diskPercent !== null && (
                <>
                  <span className="text-muted">·</span>
                  <span className={preview.diskPressureActive ? "text-rose-400" : "text-muted"}>
                    {t("retention.diskAt", { pct: preview.diskPercent.toFixed(1) })}
                  </span>
                </>
              )}
            </div>

            {preview.candidates.length > 0 ? (
              <div className="divide-y divide-border border border-border rounded-md max-h-96 overflow-y-auto">
                {preview.candidates.map((c) => (
                  <div key={c.mediaId} className="px-4 py-2.5 flex items-center gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="truncate">
                        {c.title}
                        {c.year ? ` (${c.year})` : ""}
                        <span className="ml-2 text-[10px] uppercase text-muted/70">{c.type}</span>
                      </div>
                      <div className="text-xs text-muted truncate">{c.detail}</div>
                    </div>
                    <div className="text-xs text-muted font-mono">{formatBytes(c.sizeBytes)}</div>
                    <button
                      onClick={() => exclude.mutate(c.mediaId)}
                      title={t("retention.keepSixMonths")}
                      className="px-2 py-1 text-xs rounded border border-border hover:bg-white/5 flex items-center gap-1"
                    >
                      <ShieldOff className="w-3 h-3" />
                      {t("retention.keep")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-muted flex gap-2 items-center">
                <Check className="w-4 h-4 text-emerald-400" />
                {t("retention.nothingToDelete")}
              </div>
            )}
          </>
        )}
      </div>

      {/* Last-run summary */}
      {form.lastRunSummary && form.lastRunSummary.deleted > 0 && (
        <div className="bg-surface border border-border rounded-lg p-4 text-sm text-muted flex gap-3 items-start">
          <CircleX className="w-4 h-4 text-rose-400 mt-0.5 shrink-0" />
          <div>
            {t("retention.lastRunDeleted", {
              count: String(form.lastRunSummary.deleted),
              bytes: formatBytes(form.lastRunSummary.bytesFreed),
            })}
          </div>
        </div>
      )}
    </div>
  );
}
