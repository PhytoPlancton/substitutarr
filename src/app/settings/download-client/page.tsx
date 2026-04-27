"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Section, Field } from "@/components/SettingsForm";
import { StatusDot, type ConnStatus, relativeTime } from "@/components/StatusDot";
import { TestSaveButtons, type TestResult } from "@/components/TestSaveButtons";

type Settings = {
  qbittorrent?: { url?: string; user?: string; password?: string; category?: string };
};

export default function DownloadClientPage() {
  const qc = useQueryClient();
  const { data } = useQuery<{ settings: Settings | null; effective?: Settings }>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch("/api/settings")).json(),
  });
  const { data: health } = useQuery<{ services: Record<string, any> }>({
    queryKey: ["health-services"],
    queryFn: async () => (await fetch("/api/health/services")).json(),
  });
  const stored = health?.services?.qbit;

  const [form, setForm] = useState<Settings>({});
  const [status, setStatus] = useState<ConnStatus>("unknown");
  const [hint, setHint] = useState<string | undefined>();

  // Prefer "effective" (DB merged with env fallbacks) so the user sees the
  // values that are actually used at runtime, not just what's persisted.
  useEffect(() => {
    const src = data?.effective ?? data?.settings;
    if (src) setForm(src);
  }, [data]);
  useEffect(() => {
    if (stored?.status) {
      setStatus(stored.status);
      setHint(relativeTime(stored.lastTestedAt));
    }
  }, [stored]);

  const set = (patch: Settings["qbittorrent"]) =>
    setForm((f) => ({ ...f, qbittorrent: { ...f.qbittorrent, ...patch } }));

  const save = useMutation({
    mutationFn: async (s: Settings) =>
      fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(s),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const test = async (): Promise<TestResult> => {
    const cfg = form.qbittorrent ?? {};
    if (!cfg.url || !cfg.user || !cfg.password) {
      return {
        ok: false,
        title: "Missing fields",
        detail: "URL, user and password are required.",
      };
    }
    const r = await fetch("/api/test/qbit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    return r.json();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Download client</h1>
          <p className="text-muted text-sm mt-1">
            qBittorrent reçoit les torrents qu'on grab. Substitutarr ne touche pas au save path —
            il garde celui que qBit a configuré.
          </p>
        </div>
        <StatusDot status={status} hint={hint} />
      </header>

      <Section title="qBittorrent">
        <Field
          label="URL"
          value={form.qbittorrent?.url}
          onChange={(v) => set({ url: v })}
          placeholder="http://82.66.229.27:8080"
        />
        <Field
          label="Category (optionnelle)"
          value={form.qbittorrent?.category}
          onChange={(v) => set({ category: v })}
          placeholder="substitutarr"
        />
        <Field label="User" value={form.qbittorrent?.user} onChange={(v) => set({ user: v })} />
        <Field
          label="Password"
          type="password"
          value={form.qbittorrent?.password}
          onChange={(v) => set({ password: v })}
        />
      </Section>

      <TestSaveButtons
        onTest={test}
        onSave={async () => {
          await save.mutateAsync(form);
          qc.invalidateQueries({ queryKey: ["health-services"] });
        }}
        onStatus={(s) => {
          setStatus(s);
          if (s === "connected" || s === "error") setHint("just now");
        }}
      />
    </div>
  );
}
