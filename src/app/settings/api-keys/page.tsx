"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { SettingsHeader } from "@/components/SettingsForm";
import { useT } from "@/lib/i18n/I18nProvider";

type ApiKey = {
  name: string;
  keyPreview: string;
  scopes?: string[];
  expiresAt?: string;
  createdAt: string;
  lastUsedAt?: string;
  usageCount?: number;
};

export default function ApiKeysPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery<{ items: ApiKey[] }>({
    queryKey: ["api-keys"],
    queryFn: async () => (await fetch("/api/api-keys")).json(),
  });
  const [name, setName] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async (n: string) =>
      fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      }).then((r) => r.json()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["api-keys"] });
      setRevealed(r.key);
      setName("");
    },
  });
  const del = useMutation({
    mutationFn: async (preview: string) =>
      fetch(`/api/api-keys?preview=${encodeURIComponent(preview)}`, { method: "DELETE" }).then((r) =>
        r.json(),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  return (
    <div className="space-y-6 max-w-3xl">
      <SettingsHeader title={t("apiKeys.title")} />

      {revealed && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm">
          <div className="font-medium text-amber-400 mb-1">{t("apiKeys.copyNow")}</div>
          <code className="block bg-bg p-2 rounded text-xs break-all">{revealed}</code>
          <button onClick={() => setRevealed(null)} className="mt-2 text-xs text-muted hover:text-white">
            {t("apiKeys.dismiss")}
          </button>
        </div>
      )}

      <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="space-y-2">
          {(data?.items ?? []).length === 0 && (
            <p className="text-sm text-muted">{t("apiKeys.none")}</p>
          )}
          {(data?.items ?? []).map((k) => (
            <div
              key={k.keyPreview}
              className="flex items-center justify-between bg-bg border border-border rounded-md px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <span className="font-medium">{k.name}</span>
                <span className="text-muted text-xs ml-2">{k.keyPreview}</span>
                <div className="text-muted text-xs mt-0.5 flex flex-wrap gap-x-3">
                  <span>{t("apiKeys.scopesLabel")} {(k.scopes ?? []).join(", ") || "—"}</span>
                  {k.expiresAt && (
                    <span>{t("apiKeys.expiresLabel", { date: new Date(k.expiresAt).toLocaleDateString() })}</span>
                  )}
                  {k.lastUsedAt && (
                    <span>{t("apiKeys.lastUsedLabel", { date: new Date(k.lastUsedAt).toLocaleDateString() })}</span>
                  )}
                  {typeof k.usageCount === "number" && (
                    <span>{t("apiKeys.callsLabel", { count: k.usageCount })}</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => confirm(t("apiKeys.revokeConfirm")) && del.mutate(k.keyPreview)}
                className="p-1 rounded hover:bg-rose-500/15 text-rose-400 shrink-0"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 border-t border-border pt-4">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("apiKeys.placeholder")}
            className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm"
          />
          <button
            onClick={() => name && create.mutate(name)}
            disabled={!name || create.isPending}
            className="flex items-center gap-1 bg-accent text-white rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {t("apiKeys.create")}
          </button>
        </div>
      </section>
    </div>
  );
}
