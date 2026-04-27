"use client";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X, Zap, Loader2, ChevronDown, ChevronUp, Star } from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

type Reason = { source: string; points: number };
type ScoredRelease = {
  title: string;
  url?: string;
  magnet?: string;
  infoHash?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  quality?: string;
  indexer: string;
  publishedAt?: string;
  parsed: any;
  scoreBreakdown: { total: number; reasons: Reason[]; rejected?: string };
};
type Rejected = { release: Omit<ScoredRelease, "parsed" | "scoreBreakdown">; reason: string };

type Profile = { _id: string; name: string };

type Props = {
  mediaId: string;
  mediaTitle: string;
  onClose: () => void;
};

const fmtBytes = (b?: number) => {
  if (!b) return "—";
  let v = b;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
};

export function SearchModal({ mediaId, mediaTitle, onClose }: Props) {
  const t = useT();
  const qc = useQueryClient();
  const { data: profiles } = useQuery<{ items: Profile[] }>({
    queryKey: ["profiles"],
    queryFn: async () => (await fetch("/api/profiles")).json(),
  });
  const [profileId, setProfileId] = useState<string | null>(null);

  const { data, isFetching, error } = useQuery<{
    releases: ScoredRelease[];
    rejected: Rejected[];
    errors: { indexer: string; message: string }[];
    profile: string;
    profileId: string;
  }>({
    queryKey: ["search-explain", mediaId, profileId],
    queryFn: async () => {
      const qs = new URLSearchParams({ mediaId });
      if (profileId) qs.set("profileId", profileId);
      const r = await fetch(`/api/indexers/search?${qs}`);
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  });

  const grab = useMutation({
    mutationFn: async (release: {
      magnet?: string;
      url?: string;
      title: string;
      infoHash?: string;
      indexer?: string;
      quality?: string;
      sizeBytes?: number;
      seeders?: number;
    }) => {
      const link = release.magnet ?? release.url;
      if (!link) throw new Error("no link");
      const r = await fetch("/api/grab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mediaId,
          magnet: link,
          title: release.title,
          infoHash: release.infoHash,
          indexer: release.indexer,
          quality: release.quality,
          sizeBytes: release.sizeBytes,
          seeders: release.seeders,
        }),
      });
      return r.json();
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["downloads"] });
      qc.invalidateQueries({ queryKey: ["library"] });
      if (r.ok) onClose();
      else alert(t("searchModal.grabFailed", { error: r.error ?? "?" }));
    },
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-start justify-center pt-12 pb-12 px-4 overflow-auto">
      <div className="w-full max-w-5xl bg-surface border border-border rounded-lg shadow-2xl">
        <header className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">{mediaTitle}</h2>
            <div className="text-xs text-muted mt-1 flex items-center gap-3">
              <span>{t("searchModal.profileLabel")}</span>
              <select
                value={profileId ?? ""}
                onChange={(e) => setProfileId(e.target.value || null)}
                className="bg-bg border border-border rounded px-2 py-1 text-xs"
              >
                <option value="">{t("searchModal.profileDefault")}</option>
                {profiles?.items?.map((p) => (
                  <option key={p._id} value={p._id}>{p.name}</option>
                ))}
              </select>
              {data && (
                <span>
                  · {t("searchModal.summary", { accepted: data.releases.length, rejected: data.rejected.length })}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded hover:bg-white/5"><X className="w-5 h-5" /></button>
        </header>

        <div className="p-5 space-y-6 max-h-[70vh] overflow-auto">
          {isFetching && (
            <div className="flex items-center justify-center gap-2 text-muted py-12">
              <Loader2 className="w-4 h-4 animate-spin" /> {t("searchModal.searching")}
            </div>
          )}

          {error && <div className="text-rose-400 text-sm">Error: {(error as Error).message}</div>}

          {data?.errors?.length ? (
            <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded p-3">
              {data.errors.map((e) => `${e.indexer}: ${e.message}`).join(" · ")}
            </div>
          ) : null}

          {data && (
            <>
              <Section
                title={t("searchModal.acceptedTitle", {
                  profile: data.profile,
                  count: data.releases.length,
                })}
                subtitle={t("searchModal.acceptedSubtitle")}
              >
                {data.releases.length === 0 && <Empty msg={t("searchModal.emptyAccepted")} /> }
                {data.releases.map((r, i) => (
                  <ReleaseRow
                    key={r.infoHash ?? r.title}
                    isBest={i === 0}
                    title={r.title}
                    score={r.scoreBreakdown.total}
                    reasons={r.scoreBreakdown.reasons}
                    indexer={r.indexer}
                    seeders={r.seeders}
                    sizeBytes={r.sizeBytes}
                    parsed={r.parsed}
                    onGrab={() => grab.mutate(r)}
                    grabbing={grab.isPending}
                  />
                ))}
              </Section>

              {data.rejected.length > 0 && (
                <Section
                  title={t("searchModal.rejectedTitle", { count: data.rejected.length })}
                  subtitle={t("searchModal.rejectedSubtitle")}
                >
                  {data.rejected.map((r) => (
                    <ReleaseRow
                      key={r.release.infoHash ?? r.release.title}
                      title={r.release.title}
                      indexer={r.release.indexer}
                      seeders={r.release.seeders}
                      sizeBytes={r.release.sizeBytes}
                      rejection={r.reason}
                      onGrab={() => grab.mutate(r.release)}
                      grabbing={grab.isPending}
                    />
                  ))}
                </Section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm uppercase tracking-wider text-muted mb-1">{title}</h3>
      {subtitle && <p className="text-xs text-muted mb-3">{subtitle}</p>}
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="text-sm text-muted text-center py-6 bg-bg border border-border rounded">{msg}</div>;
}

function ReleaseRow(props: {
  title: string;
  indexer: string;
  seeders?: number;
  sizeBytes?: number;
  score?: number;
  reasons?: Reason[];
  parsed?: any;
  rejection?: string;
  isBest?: boolean;
  onGrab: () => void;
  grabbing: boolean;
}) {
  const [open, setOpen] = useState(false);
  const accepted = !props.rejection;

  return (
    <div className={`bg-bg border rounded ${props.isBest ? "border-accent" : "border-border"}`}>
      <div className="p-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {props.isBest && <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400 shrink-0" />}
            <span className="text-sm font-medium truncate">{props.title}</span>
          </div>
          <div className="text-xs text-muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{props.indexer}</span>
            <span>{fmtBytes(props.sizeBytes)}</span>
            <span>{props.seeders ?? 0} seeders</span>
            {accepted && typeof props.score === "number" && (
              <span className="text-accent font-medium">score {props.score}</span>
            )}
            {props.rejection && <span className="text-rose-400">{props.rejection}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {(props.reasons?.length || props.parsed) && (
            <button onClick={() => setOpen((v) => !v)} className="p-1 rounded hover:bg-white/5 text-muted">
              {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={props.onGrab}
            disabled={props.grabbing}
            className={`p-1.5 rounded ${accepted ? "bg-accent/15 text-accent hover:bg-accent/25" : "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"} disabled:opacity-50`}
            title={accepted ? "Grab this release" : "Force-grab (override profile)"}
          >
            <Zap className="w-4 h-4" />
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border px-3 py-2 text-xs text-muted space-y-2">
          {props.reasons && props.reasons.length > 0 && (
            <div>
              <div className="font-medium text-white mb-1">Score breakdown</div>
              <div className="grid grid-cols-2 gap-x-4">
                {props.reasons.map((r, i) => (
                  <div key={i} className="flex justify-between">
                    <span>{r.source}</span>
                    <span className={r.points >= 0 ? "text-emerald-400" : "text-rose-400"}>
                      {r.points >= 0 ? "+" : ""}{r.points}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {props.parsed && (
            <div>
              <div className="font-medium text-white mb-1">Parsed dimensions</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-0.5">
                {Object.entries(props.parsed)
                  .filter(([k, v]) => v !== undefined && v !== null && k !== "raw" && (Array.isArray(v) ? v.length > 0 : true))
                  .map(([k, v]) => (
                    <div key={k} className="truncate">
                      <span className="text-muted/70">{k}:</span>{" "}
                      <span>{Array.isArray(v) ? v.join(", ") : String(v)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
