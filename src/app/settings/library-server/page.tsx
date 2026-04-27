"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Section, Field } from "@/components/SettingsForm";
import { StatusDot, type ConnStatus, relativeTime } from "@/components/StatusDot";
import { TestSaveButtons, type TestResult } from "@/components/TestSaveButtons";
import { useT } from "@/lib/i18n/I18nProvider";

type Settings = {
  jellyfin?: { url?: string; apiKey?: string; autoRefresh?: boolean };
};

export default function LibraryServerPage() {
  const t = useT();
  const qc = useQueryClient();
  const { data } = useQuery<{ settings: Settings | null; effective?: Settings }>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch("/api/settings")).json(),
  });
  const { data: health } = useQuery<{ services: Record<string, any> }>({
    queryKey: ["health-services"],
    queryFn: async () => (await fetch("/api/health/services")).json(),
  });
  const stored = health?.services?.jellyfin;

  const [form, setForm] = useState<Settings>({});
  const [status, setStatus] = useState<ConnStatus>("unknown");
  const [hint, setHint] = useState<string | undefined>();

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

  const set = (patch: Settings["jellyfin"]) =>
    setForm((f) => ({ ...f, jellyfin: { ...f.jellyfin, ...patch } }));

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
    const cfg = form.jellyfin ?? {};
    if (!cfg.url || !cfg.apiKey)
      return {
        ok: false,
        title: t("test.missingFields"),
        detail: t("test.missingFieldsDetailJellyfin"),
      };
    const r = await fetch("/api/test/jellyfin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: cfg.url, apiKey: cfg.apiKey }),
    });
    return r.json();
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold">{t("libraryServer.title")}</h1>
        <StatusDot status={status} hint={hint} />
      </header>

      <Section title={t("libraryServer.sectionTitle")}>
        <Field
          label={t("libraryServer.url")}
          value={form.jellyfin?.url}
          onChange={(v) => set({ url: v })}
          placeholder="http://82.66.229.27:8096"
        />
        <Field
          label={t("libraryServer.apiKey")}
          type="password"
          value={form.jellyfin?.apiKey}
          onChange={(v) => set({ apiKey: v })}
        />
        <label className="text-sm md:col-span-2 flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.jellyfin?.autoRefresh ?? true}
            onChange={(e) => set({ autoRefresh: e.target.checked })}
            className="accent-accent"
          />
          {t("libraryServer.autoRefreshLabel")}
        </label>
      </Section>

      <TestSaveButtons
        onTest={test}
        onSave={async () => {
          await save.mutateAsync(form);
          qc.invalidateQueries({ queryKey: ["health-services"] });
        }}
        onStatus={(s) => {
          setStatus(s);
          if (s === "connected" || s === "error") setHint(t("common.justNow"));
        }}
      />
    </div>
  );
}
