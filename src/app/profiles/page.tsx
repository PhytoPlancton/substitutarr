"use client";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Star, Trash2, Save, Plus, ChevronDown, ChevronUp } from "lucide-react";

type Profile = {
  _id: string;
  name: string;
  description?: string;
  appliesTo: "movie" | "tv" | "both";
  isDefault: boolean;
  fallbackProfileId?: string | null;
  filters: any;
  weights: any;
  preferredGroupsTier1: string[];
  preferredGroupsTier2: string[];
  blockedGroups: string[];
  groupTier1Bonus: number;
  groupTier2Bonus: number;
};

const RES = ["SD", "480p", "720p", "1080p", "2160p"];
const LANG_OPTIONS = ["VFF", "TRUEFRENCH", "MULTI", "FRENCH", "VFI", "VFQ", "VF2", "VOF", "DUAL", "VOSTFR", "VOST", "VO"];
const SOURCE_OPTIONS = ["REMUX", "BLURAY", "WEB-DL", "WEBRIP", "BDRIP", "BRRIP", "HDTV", "DVDRIP", "HDRIP", "DVDSCR", "TC", "TS", "HDCAM", "CAM"];

export default function ProfilesPage() {
  const qc = useQueryClient();
  const { data } = useQuery<{ items: Profile[] }>({
    queryKey: ["profiles"],
    queryFn: async () => (await fetch("/api/profiles")).json(),
  });
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId && data?.items?.[0]) setActiveId(data.items[0]._id);
  }, [data, activeId]);

  const profiles = data?.items ?? [];
  const active = profiles.find((p) => p._id === activeId);

  const profileById = (id?: string | null) => profiles.find((p) => p._id === id);

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Download profiles</h1>
          <p className="text-muted text-sm">Filtres + scoring qui choisissent automatiquement la meilleure release. Chaîne fallback si aucune release ne passe.</p>
        </div>
        <CreateButton onCreated={(id) => setActiveId(id)} />
      </header>

      <div className="grid grid-cols-12 gap-6">
        <aside className="col-span-12 md:col-span-4 space-y-1">
          {profiles.map((p) => {
            const fb = profileById(p.fallbackProfileId);
            return (
              <button
                key={p._id}
                onClick={() => setActiveId(p._id)}
                className={`w-full text-left p-3 rounded-md border transition-colors ${
                  activeId === p._id
                    ? "border-accent bg-accent/10"
                    : "border-border bg-surface hover:border-accent/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-sm">{p.name}</span>
                  {p.isDefault && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />}
                </div>
                <p className="text-xs text-muted truncate mt-0.5">{p.description}</p>
                <p className="text-xs text-muted mt-0.5">
                  {p.appliesTo}
                  {fb && <span className="ml-2">→ fallback: {fb.name}</span>}
                </p>
              </button>
            );
          })}
        </aside>

        <section className="col-span-12 md:col-span-8">
          {active ? (
            <ProfileEditor key={active._id} profile={active} allProfiles={profiles} />
          ) : (
            <p className="text-muted">Sélectionne un profil.</p>
          )}
        </section>
      </div>
    </div>
  );
}

function CreateButton({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: async () =>
      fetch("/api/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `New profile ${Date.now()}` }),
      }).then((r) => r.json()),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      if (r.item?._id) onCreated(r.item._id);
    },
  });
  return (
    <button
      onClick={() => create.mutate()}
      className="flex items-center gap-1 bg-accent text-white px-3 py-2 rounded-md text-sm font-medium hover:bg-accent/90"
    >
      <Plus className="w-4 h-4" /> New profile
    </button>
  );
}

function ProfileEditor({ profile, allProfiles }: { profile: Profile; allProfiles: Profile[] }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Profile>(profile);
  const [advanced, setAdvanced] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setDraft(profile);
    setDirty(false);
  }, [profile]);

  const update = (patch: Partial<Profile>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };
  const updateFilters = (patch: any) => update({ filters: { ...draft.filters, ...patch } });

  const save = useMutation({
    mutationFn: async () =>
      fetch(`/api/profiles/${draft._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          description: draft.description,
          appliesTo: draft.appliesTo,
          fallbackProfileId: draft.fallbackProfileId ?? null,
          filters: draft.filters,
          weights: draft.weights,
          preferredGroupsTier1: draft.preferredGroupsTier1,
          preferredGroupsTier2: draft.preferredGroupsTier2,
          blockedGroups: draft.blockedGroups,
          groupTier1Bonus: draft.groupTier1Bonus,
          groupTier2Bonus: draft.groupTier2Bonus,
        }),
      }).then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      setDirty(false);
    },
  });
  const setDefault = useMutation({
    mutationFn: async () =>
      fetch(`/api/profiles/${draft._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });
  const remove = useMutation({
    mutationFn: async () => fetch(`/api/profiles/${draft._id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const filters = draft.filters || {};

  return (
    <div className="space-y-6 bg-surface border border-border rounded-lg p-5">
      <div className="flex items-center justify-between gap-3">
        <input
          value={draft.name}
          onChange={(e) => update({ name: e.target.value })}
          className="flex-1 bg-bg border border-border rounded-md px-3 py-2 text-lg font-medium"
        />
        <div className="flex gap-1">
          <button
            disabled={profile.isDefault}
            onClick={() => setDefault.mutate()}
            title={profile.isDefault ? "Already default" : "Set as default"}
            className="p-2 rounded hover:bg-amber-500/15 disabled:opacity-30"
          >
            <Star className={`w-4 h-4 ${profile.isDefault ? "fill-amber-400 text-amber-400" : "text-muted"}`} />
          </button>
          <button
            disabled={profile.isDefault}
            onClick={() => confirm(`Delete "${profile.name}"?`) && remove.mutate()}
            className="p-2 rounded hover:bg-rose-500/15 text-rose-400 disabled:opacity-30"
            title={profile.isDefault ? "Cannot delete default profile" : "Delete"}
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <textarea
        value={draft.description ?? ""}
        onChange={(e) => update({ description: e.target.value })}
        rows={2}
        placeholder="Brief description"
        className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm"
      />

      <div className="grid grid-cols-2 gap-3">
        <Field label="Applies to">
          <select
            value={draft.appliesTo}
            onChange={(e) => update({ appliesTo: e.target.value as any })}
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="both">Both</option>
            <option value="movie">Movies only</option>
            <option value="tv">TV only</option>
          </select>
        </Field>
        <Field label="Fallback profile (used if no release passes)">
          <select
            value={draft.fallbackProfileId ?? ""}
            onChange={(e) => update({ fallbackProfileId: e.target.value || null })}
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm"
          >
            <option value="">— none —</option>
            {allProfiles
              .filter((p) => p._id !== draft._id)
              .map((p) => (
                <option key={p._id} value={p._id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
      </div>

      {/* Simple mode */}
      <Section title="Filters (simple)">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Min resolution">
            <Select value={filters.minResolution} onChange={(v) => updateFilters({ minResolution: v })} options={[""].concat(RES)} />
          </Field>
          <Field label="Max resolution">
            <Select value={filters.maxResolution} onChange={(v) => updateFilters({ maxResolution: v })} options={[""].concat(RES)} />
          </Field>
          <Field label="Min seeders">
            <input type="number" min={0} value={filters.minSeeders ?? 1} onChange={(e) => updateFilters({ minSeeders: Number(e.target.value) })} className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm" />
          </Field>
          <Field label="Min size (MB)">
            <input type="number" min={0} value={filters.minSizeMB ?? ""} onChange={(e) => updateFilters({ minSizeMB: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm" />
          </Field>
          <Field label="Max size (MB)">
            <input type="number" min={0} value={filters.maxSizeMB ?? ""} onChange={(e) => updateFilters({ maxSizeMB: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm" />
          </Field>
          <Field label="Require HDR">
            <label className="flex items-center gap-2 text-sm pt-2">
              <input type="checkbox" checked={!!filters.requireHDR} onChange={(e) => updateFilters({ requireHDR: e.target.checked })} />
              Yes
            </label>
          </Field>
        </div>

        <Field label="Required audio language(s) — at least one must match">
          <Tags value={filters.requireLanguages ?? []} options={LANG_OPTIONS} onChange={(v) => updateFilters({ requireLanguages: v })} />
        </Field>

        <Field label="Blocked sources">
          <Tags value={filters.blockedSources ?? []} options={SOURCE_OPTIONS} onChange={(v) => updateFilters({ blockedSources: v })} />
        </Field>

        <Field label="Required keywords (any) — for niche filters like &quot;ENG.SUBS&quot;, &quot;VOSTANG&quot;, &quot;Multi.Subs&quot;">
          <KeywordList value={filters.requireKeywords ?? []} onChange={(v) => updateFilters({ requireKeywords: v })} placeholder="ENG.SUBS, MultiSubs..." />
        </Field>
        <Field label="Blocked keywords">
          <KeywordList value={filters.blockedKeywords ?? []} onChange={(v) => updateFilters({ blockedKeywords: v })} placeholder="HDRip, x264-Lite..." />
        </Field>
      </Section>

      <button
        onClick={() => setAdvanced((v) => !v)}
        className="flex items-center gap-1 text-sm text-muted hover:text-white"
      >
        {advanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        Advanced (scoring weights, group tiers)
      </button>

      {advanced && <AdvancedEditor draft={draft} update={update} />}

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-border">
        {dirty && <span className="text-xs text-amber-400">Unsaved changes</span>}
        <button
          onClick={() => save.mutate()}
          disabled={!dirty || save.isPending}
          className="flex items-center gap-1 bg-accent text-white px-4 py-2 rounded-md font-medium disabled:opacity-30"
        >
          <Save className="w-4 h-4" /> {save.isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function AdvancedEditor({ draft, update }: { draft: Profile; update: (p: Partial<Profile>) => void }) {
  const w = draft.weights ?? {};
  const updateWeights = (path: string[], val: number) => {
    const next = JSON.parse(JSON.stringify(w));
    let cur = next;
    for (let i = 0; i < path.length - 1; i++) {
      cur[path[i]] = cur[path[i]] ?? {};
      cur = cur[path[i]];
    }
    cur[path[path.length - 1]] = val;
    update({ weights: next });
  };

  const flat = useMemo(() => {
    const out: { path: string[]; label: string; value: number }[] = [];
    for (const [group, val] of Object.entries(w)) {
      if (val && typeof val === "object" && !Array.isArray(val)) {
        for (const [k, v] of Object.entries(val as any))
          if (typeof v === "number") out.push({ path: [group, k], label: `${group}.${k}`, value: v });
      } else if (typeof val === "number") {
        out.push({ path: [group], label: group, value: val });
      }
    }
    return out;
  }, [w]);

  return (
    <Section title="Scoring weights — one row per dimension">
      <p className="text-xs text-muted mb-3">
        Plus c'est haut, plus la dimension est privilégiée. Les pénalités sont négatives. La langue rapporte que sa MEILLEURE valeur (pas de stacking).
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 max-h-[400px] overflow-auto pr-2">
        {flat.map(({ path, label, value }) => (
          <label key={label} className="flex items-center justify-between text-xs gap-2">
            <span className="text-muted truncate">{label}</span>
            <input
              type="number"
              value={value}
              onChange={(e) => updateWeights(path, Number(e.target.value))}
              className="w-20 bg-bg border border-border rounded px-2 py-1 text-right"
            />
          </label>
        ))}
      </div>

      <Field label="Preferred groups tier 1 (best — bonus +50 by default)">
        <KeywordList value={draft.preferredGroupsTier1 ?? []} onChange={(v) => update({ preferredGroupsTier1: v })} placeholder="HYPERION, FraMeSToR..." />
      </Field>
      <Field label="Preferred groups tier 2 (good — bonus +25)">
        <KeywordList value={draft.preferredGroupsTier2 ?? []} onChange={(v) => update({ preferredGroupsTier2: v })} placeholder="Slay3R, KAF..." />
      </Field>
      <Field label="Blocked groups (hard filter)">
        <KeywordList value={draft.blockedGroups ?? []} onChange={(v) => update({ blockedGroups: v })} placeholder="YIFY, YTS..." />
      </Field>
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm uppercase tracking-wider text-muted">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-muted mb-1" dangerouslySetInnerHTML={{ __html: label }} />
      {children}
    </label>
  );
}

function Select({ value, onChange, options }: { value: string | undefined; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm"
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {o || "—"}
        </option>
      ))}
    </select>
  );
}

function Tags({ value, options, onChange }: { value: string[]; options: string[]; onChange: (v: string[]) => void }) {
  const toggle = (o: string) => {
    onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value.includes(o);
        return (
          <button
            key={o}
            onClick={(e) => { e.preventDefault(); toggle(o); }}
            className={`px-2 py-0.5 rounded text-xs border transition-colors ${
              active ? "border-accent bg-accent/15 text-accent" : "border-border text-muted hover:text-white"
            }`}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function KeywordList({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (!t) return;
    onChange([...new Set([...value, t])]);
    setDraft("");
  };
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-bg border border-border text-xs">
            {v}
            <button onClick={() => onChange(value.filter((x) => x !== v))} className="text-muted hover:text-rose-400">×</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
          placeholder={placeholder}
          className="flex-1 bg-bg border border-border rounded-md px-3 py-1.5 text-sm"
        />
        <button onClick={add} className="px-3 py-1.5 bg-accent/20 text-accent rounded-md text-xs">Add</button>
      </div>
    </div>
  );
}
