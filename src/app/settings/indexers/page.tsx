"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Plug, Loader2, AlertCircle } from "lucide-react";
import { SettingsHeader } from "@/components/SettingsForm";
import { StatusDot, type ConnStatus, relativeTime } from "@/components/StatusDot";
import { useT } from "@/lib/i18n/I18nProvider";

type IndexerItem = {
  _id: string;
  name: string;
  kind: "yts" | "eztv" | "torznab" | "rss";
  url?: string;
  apiKey?: string;
  enabled: boolean;
  priority: number;
};

export default function IndexersPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery<{ items: IndexerItem[] }>({
    queryKey: ["indexers"],
    queryFn: async () => (await fetch("/api/indexers")).json(),
  });
  const { data: health } = useQuery<{ services: Record<string, any> }>({
    queryKey: ["health-services"],
    queryFn: async () => (await fetch("/api/health/services")).json(),
    refetchInterval: 15_000, // tests update health, refresh dots periodically
  });

  const [draft, setDraft] = useState<Partial<IndexerItem>>({
    kind: "torznab",
    priority: 50,
    enabled: true,
  });

  const add = useMutation({
    mutationFn: async (i: Partial<IndexerItem>) =>
      fetch("/api/indexers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(i),
      }).then((r) => r.json()),
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey: ["indexers"] });
      if (resp?.error) alert(typeof resp.error === "string" ? resp.error : JSON.stringify(resp.error));
      else setDraft({ kind: "torznab", priority: 50, enabled: true });
    },
  });
  const del = useMutation({
    mutationFn: async (id: string) =>
      fetch(`/api/indexers/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indexers"] }),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <SettingsHeader title={t("indexers.title")} />

      <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="space-y-2">
          {(data?.items ?? []).length === 0 && (
            <p className="text-sm text-muted">{t("indexers.none")}</p>
          )}
          {(data?.items ?? []).map((i) => (
            <IndexerRow
              key={i._id}
              indexer={i}
              health={health?.services?.[`indexer:${i._id}`]}
              onTested={() => qc.invalidateQueries({ queryKey: ["health-services"] })}
              onDelete={() =>
                confirm(t("indexers.deleteConfirm", { name: i.name })) && del.mutate(i._id)
              }
            />
          ))}
        </div>

        <div className="border-t border-border pt-4 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-muted">{t("indexers.addNew")}</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              placeholder={t("indexers.name")}
              value={draft.name ?? ""}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="bg-bg border border-border rounded-md px-3 py-2 text-sm"
            />
            <select
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as any })}
              className="bg-bg border border-border rounded-md px-3 py-2 text-sm"
            >
              <option value="torznab">Torznab (YGG, c411, custom)</option>
              <option value="yts">YTS (movies)</option>
              <option value="eztv">EZTV (TV)</option>
            </select>
            <input
              placeholder={t("indexers.url")}
              value={draft.url ?? ""}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
              className="bg-bg border border-border rounded-md px-3 py-2 text-sm"
            />
            {draft.kind === "torznab" && (
              <input
                placeholder={t("indexers.apiKey")}
                type="password"
                value={draft.apiKey ?? ""}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                className="bg-bg border border-border rounded-md px-3 py-2 text-sm md:col-span-2"
              />
            )}
            <button
              onClick={() => add.mutate(draft)}
              disabled={!draft.name || add.isPending}
              className="flex items-center justify-center gap-1 bg-accent rounded-md px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> {t("indexers.add")}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function IndexerRow({
  indexer,
  health,
  onTested,
  onDelete,
}: {
  indexer: IndexerItem;
  health?: { status: ConnStatus; lastTestedAt?: string; detail?: string };
  onTested: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [testing, setTesting] = useState(false);
  const [localStatus, setLocalStatus] = useState<ConnStatus | null>(null);
  const [localDetail, setLocalDetail] = useState<string | undefined>();
  const [showDetail, setShowDetail] = useState(false);

  const status: ConnStatus = localStatus ?? health?.status ?? "unknown";
  const detail = localDetail ?? health?.detail;
  const hint = relativeTime(localStatus ? new Date() : health?.lastTestedAt);

  const handleTest = async () => {
    setTesting(true);
    setLocalStatus("testing");
    const start = Date.now();
    try {
      const r = await fetch(`/api/test/indexer/${indexer._id}`, { method: "POST" }).then((x) =>
        x.json(),
      );
      const elapsed = Date.now() - start;
      if (elapsed < 400) await new Promise((res) => setTimeout(res, 400 - elapsed));
      setLocalStatus(r.ok ? "connected" : "error");
      setLocalDetail(r.detail ?? r.title);
      onTested();
    } catch (e: any) {
      setLocalStatus("error");
      setLocalDetail(e.message ?? String(e));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="bg-bg border border-border rounded-md">
      <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusDot status={status} label={indexer.name} />
            <span className="text-muted text-xs">[{indexer.kind}]</span>
          </div>
          {indexer.url && (
            <div className="text-muted text-xs truncate mt-0.5">{indexer.url}</div>
          )}
          {hint && status !== "unknown" && (
            <div className="text-muted/70 text-[11px] mt-0.5">
              {t("indexers.testedRel", { when: hint })}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleTest}
            disabled={testing}
            title={t("indexers.testTitle")}
            className="p-1.5 rounded border border-border hover:bg-white/5 disabled:opacity-50"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plug className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded hover:bg-rose-500/15 text-rose-400"
            title={t("indexers.deleteTitle")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {status === "error" && detail && (
        <div className="border-t border-border px-3 py-2">
          <button
            onClick={() => setShowDetail((v) => !v)}
            className="flex items-center gap-1 text-xs text-rose-400 hover:underline"
          >
            <AlertCircle className="w-3 h-3" />
            {showDetail ? t("indexers.hideDetails") : t("indexers.showDetails")}
          </button>
          {showDetail && (
            <pre className="mt-2 text-[11px] font-mono text-rose-400/80 break-all whitespace-pre-wrap">
              {detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
