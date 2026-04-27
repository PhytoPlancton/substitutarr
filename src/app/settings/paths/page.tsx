"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SettingsHeader, Section, Field, SaveButton } from "@/components/SettingsForm";
import { useT } from "@/lib/i18n/I18nProvider";

type Settings = {
  paths?: { movies?: string; tv?: string; downloads?: string };
};

export default function PathsPage() {
  const t = useT();
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

  const set = (patch: Settings["paths"]) =>
    setForm((f) => ({ ...f, paths: { ...f.paths, ...patch } }));

  return (
    <div className="space-y-6 max-w-3xl">
      <SettingsHeader title={t("paths.title")} />

      <Section>
        <Field
          label={t("paths.movies")}
          value={form.paths?.movies}
          onChange={(v) => set({ movies: v })}
          placeholder={t("paths.placeholder")}
        />
        <Field
          label={t("paths.tv")}
          value={form.paths?.tv}
          onChange={(v) => set({ tv: v })}
          placeholder={t("paths.placeholder")}
        />
        <Field
          label={t("paths.downloads")}
          value={form.paths?.downloads}
          onChange={(v) => set({ downloads: v })}
          placeholder={t("paths.placeholder")}
        />
      </Section>

      <SaveButton pending={save.isPending} onClick={() => save.mutate(form)} label={t("common.save")} />
    </div>
  );
}
