"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { SettingsHeader } from "@/components/SettingsForm";

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
      <SettingsHeader
        title="API keys"
        description="Pour ton site streaming → POST /api/external/request avec Authorization: Bearer ars_…  ·  body: { type, tmdbId, autoGrab? }."
      />

      {revealed && (
        <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm">
          <div className="font-medium text-amber-400 mb-1">Copy this key now — it won't be shown again.</div>
          <code className="block bg-bg p-2 rounded text-xs break-all">{revealed}</code>
          <button onClick={() => setRevealed(null)} className="mt-2 text-xs text-muted hover:text-white">
            Dismiss
          </button>
        </div>
      )}

      <section className="bg-surface border border-border rounded-lg p-5 space-y-4">
        <div className="space-y-2">
          {(data?.items ?? []).length === 0 && (
            <p className="text-sm text-muted">Aucune clé. Crée-en une ci-dessous.</p>
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
                  <span>scopes: {(k.scopes ?? []).join(", ") || "—"}</span>
                  {k.expiresAt && <span>expires {new Date(k.expiresAt).toLocaleDateString()}</span>}
                  {k.lastUsedAt && (
                    <span>last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
                  )}
                  {typeof k.usageCount === "number" && <span>{k.usageCount} calls</span>}
                </div>
              </div>
              <button
                onClick={() => confirm("Revoke this key?") && del.mutate(k.keyPreview)}
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
            placeholder="e.g. Streaming site"
            className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-sm"
          />
          <button
            onClick={() => name && create.mutate(name)}
            disabled={!name || create.isPending}
            className="flex items-center gap-1 bg-accent text-white rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Create
          </button>
        </div>
      </section>
    </div>
  );
}
