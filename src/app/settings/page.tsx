"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

type Settings = {
  qbittorrent?: { url?: string; user?: string; password?: string; category?: string };
  jellyfin?: { url?: string; apiKey?: string; autoRefresh?: boolean };
  paths?: { movies?: string; tv?: string; downloads?: string };
  quality?: { preferred?: string; fallback?: string; minSeeders?: number };
};

type IndexerItem = {
  _id: string;
  name: string;
  kind: "yts" | "eztv" | "torznab" | "rss";
  url?: string;
  apiKey?: string;
  enabled: boolean;
  priority: number;
};

export default function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery<{ settings: Settings | null }>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch("/api/settings")).json(),
  });

  const [form, setForm] = useState<Settings>({});
  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data]);

  const save = useMutation({
    mutationFn: async (s: Settings) =>
      fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  return (
    <div className="space-y-8 max-w-3xl">
      <header>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-muted text-sm">Per-user. Nothing leaves your account.</p>
      </header>

      <Section title="qBittorrent">
        <Field label="URL" value={form.qbittorrent?.url} onChange={(v) => setForm({ ...form, qbittorrent: { ...form.qbittorrent, url: v } })} placeholder="http://82.66.229.27:8080" />
        <Field label="User" value={form.qbittorrent?.user} onChange={(v) => setForm({ ...form, qbittorrent: { ...form.qbittorrent, user: v } })} />
        <Field label="Password" type="password" value={form.qbittorrent?.password} onChange={(v) => setForm({ ...form, qbittorrent: { ...form.qbittorrent, password: v } })} />
        <Field label="Category" value={form.qbittorrent?.category} onChange={(v) => setForm({ ...form, qbittorrent: { ...form.qbittorrent, category: v } })} placeholder="substitutarr" />
      </Section>

      <Section title="Jellyfin">
        <Field label="URL" value={form.jellyfin?.url} onChange={(v) => setForm({ ...form, jellyfin: { ...form.jellyfin, url: v } })} />
        <Field label="API Key" type="password" value={form.jellyfin?.apiKey} onChange={(v) => setForm({ ...form, jellyfin: { ...form.jellyfin, apiKey: v } })} />
      </Section>

      <Section title="Paths (server-side)">
        <Field label="Movies" value={form.paths?.movies} onChange={(v) => setForm({ ...form, paths: { ...form.paths, movies: v } })} />
        <Field label="TV" value={form.paths?.tv} onChange={(v) => setForm({ ...form, paths: { ...form.paths, tv: v } })} />
      </Section>

      <Section title="Quality">
        <Field label="Preferred" value={form.quality?.preferred} onChange={(v) => setForm({ ...form, quality: { ...form.quality, preferred: v } })} placeholder="1080p / 2160p / 720p" />
        <Field label="Min seeders" type="number" value={String(form.quality?.minSeeders ?? "")} onChange={(v) => setForm({ ...form, quality: { ...form.quality, minSeeders: Number(v) || 0 } })} />
      </Section>

      <button
        onClick={() => save.mutate(form)}
        disabled={save.isPending}
        className="px-4 py-2.5 bg-accent rounded-md font-medium text-white hover:bg-accent/90 disabled:opacity-50"
      >
        {save.isPending ? "Saving..." : "Save settings"}
      </button>

      <IndexersSection />
      <ApiKeysSection />
    </div>
  );
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const { data } = useQuery<{ items: { name: string; keyPreview: string; createdAt: string; lastUsedAt?: string }[] }>(
    {
      queryKey: ["api-keys"],
      queryFn: async () => (await fetch("/api/api-keys")).json(),
    },
  );
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
      fetch(`/api/api-keys?preview=${encodeURIComponent(preview)}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <h2 className="text-sm uppercase tracking-wider text-muted mb-2">API keys (external integrations)</h2>
      <p className="text-xs text-muted mb-4">
        Pour ton site streaming → POST{" "}
        <code className="bg-bg px-1 rounded">/api/external/request</code> avec{" "}
        <code className="bg-bg px-1 rounded">Authorization: Bearer ars_…</code>, body{" "}
        <code className="bg-bg px-1 rounded">{`{ type, tmdbId }`}</code>.
      </p>

      {revealed && (
        <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm">
          <div className="font-medium text-amber-400 mb-1">Copy this key now — it won't be shown again.</div>
          <code className="block bg-bg p-2 rounded text-xs break-all">{revealed}</code>
          <button onClick={() => setRevealed(null)} className="mt-2 text-xs text-muted hover:text-white">Dismiss</button>
        </div>
      )}

      <div className="space-y-2 mb-3">
        {(data?.items ?? []).map((k) => (
          <div key={k.keyPreview} className="flex items-center justify-between bg-bg border border-border rounded px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{k.name}</span>
              <span className="text-muted text-xs ml-2">{k.keyPreview}</span>
              {k.lastUsedAt && (
                <span className="text-muted text-xs ml-2">last used {new Date(k.lastUsedAt).toLocaleDateString()}</span>
              )}
            </div>
            <button onClick={() => confirm("Revoke this key?") && del.mutate(k.keyPreview)} className="p-1 rounded hover:bg-rose-500/15 text-rose-400">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
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
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <h2 className="text-sm uppercase tracking-wider text-muted mb-4">{title}</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="text-sm">
      <span className="block text-xs text-muted mb-1">{label}</span>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        className="w-full bg-bg border border-border rounded-md px-3 py-2 outline-none focus:border-accent"
      />
    </label>
  );
}

function IndexersSection() {
  const qc = useQueryClient();
  const { data } = useQuery<{ items: IndexerItem[] }>({
    queryKey: ["indexers"],
    queryFn: async () => (await fetch("/api/indexers")).json(),
  });
  const [draft, setDraft] = useState<Partial<IndexerItem>>({ kind: "yts", priority: 50, enabled: true });

  const add = useMutation({
    mutationFn: async (i: Partial<IndexerItem>) =>
      fetch("/api/indexers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(i),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["indexers"] });
      setDraft({ kind: "yts", priority: 50, enabled: true });
    },
  });
  const del = useMutation({
    mutationFn: async (id: string) => fetch(`/api/indexers/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["indexers"] }),
  });

  return (
    <section className="bg-surface border border-border rounded-lg p-5">
      <h2 className="text-sm uppercase tracking-wider text-muted mb-4">Indexers</h2>

      <div className="space-y-2 mb-4">
        {(data?.items ?? []).map((i) => (
          <div key={i._id} className="flex items-center justify-between bg-bg border border-border rounded-md px-3 py-2 text-sm">
            <div>
              <span className="font-medium">{i.name}</span>{" "}
              <span className="text-muted text-xs">[{i.kind}]</span>
              {i.url && <span className="text-muted text-xs ml-2">{i.url}</span>}
            </div>
            <button onClick={() => del.mutate(i._id)} className="p-1 rounded hover:bg-rose-500/15 text-rose-400">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          placeholder="Name"
          value={draft.name ?? ""}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="bg-bg border border-border rounded-md px-3 py-2 text-sm"
        />
        <select
          value={draft.kind}
          onChange={(e) => setDraft({ ...draft, kind: e.target.value as any })}
          className="bg-bg border border-border rounded-md px-3 py-2 text-sm"
        >
          <option value="yts">YTS (movies)</option>
          <option value="eztv">EZTV (TV)</option>
          <option value="torznab">Torznab (private/custom)</option>
        </select>
        <input
          placeholder="URL (torznab only)"
          value={draft.url ?? ""}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
          className="bg-bg border border-border rounded-md px-3 py-2 text-sm"
        />
        {draft.kind === "torznab" && (
          <input
            placeholder="API key"
            value={draft.apiKey ?? ""}
            onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
            className="bg-bg border border-border rounded-md px-3 py-2 text-sm md:col-span-2"
          />
        )}
        <button
          onClick={() => add.mutate(draft)}
          disabled={!draft.name}
          className="flex items-center justify-center gap-1 bg-accent rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </section>
  );
}
