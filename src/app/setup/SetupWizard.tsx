"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleAlert,
  Loader2,
  Folder,
  HardDriveDownload,
  Tags,
  Terminal,
  Sparkles,
  Download,
  Copy,
  RefreshCw,
} from "lucide-react";
import { useT } from "@/lib/i18n/I18nProvider";

type StepId = "welcome" | "paths" | "qbit" | "categories" | "hook" | "done";
type StepState = "ok" | "pending" | "error";

type StatusResp = {
  setupComplete: boolean;
  setupCompletedAt: string | null;
  steps: {
    paths: { state: StepState; detail?: string; moviesRoot?: string; tvRoot?: string };
    qbit: { state: StepState; detail?: string };
    categories: { state: StepState };
    indexers: { state: StepState; count: number };
    jellyfin: { state: StepState; configured: boolean };
  };
};

const STEPS: { id: Exclude<StepId, "welcome" | "done">; key: string; icon: any }[] = [
  { id: "paths", key: "setup.stepPaths", icon: Folder },
  { id: "qbit", key: "setup.stepQbit", icon: HardDriveDownload },
  { id: "categories", key: "setup.stepCategories", icon: Tags },
  { id: "hook", key: "setup.stepHook", icon: Terminal },
];

export default function SetupWizard() {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const [current, setCurrent] = useState<StepId>("welcome");

  const { data: status, refetch } = useQuery<StatusResp>({
    queryKey: ["setup-status"],
    queryFn: async () => (await fetch("/api/setup/status")).json(),
    refetchOnWindowFocus: false,
  });

  // Auto-skip past completed steps the first time we land on the wizard
  useEffect(() => {
    if (!status || current !== "welcome") return;
    if (status.setupComplete) {
      setCurrent("done");
      return;
    }
  }, [status, current]);

  const stepNumber = useMemo(() => {
    if (current === "welcome") return 0;
    if (current === "done") return STEPS.length + 1;
    return STEPS.findIndex((s) => s.id === current) + 1;
  }, [current]);

  return (
    <div className="min-h-screen w-full">
      <div className="max-w-3xl mx-auto px-4 py-12 space-y-8">
        {/* Header / progress */}
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            {t("setup.title")}
          </h1>
          <div className="text-sm text-muted">
            {current !== "welcome" && current !== "done" && `${stepNumber} / ${STEPS.length}`}
          </div>
        </header>

        {current !== "welcome" && current !== "done" && (
          <Stepper current={current} status={status} />
        )}

        {/* Step content */}
        {current === "welcome" && <Welcome onStart={() => setCurrent("paths")} />}
        {current === "paths" && (
          <PathsStep
            initial={{
              moviesRoot: status?.steps.paths.moviesRoot ?? "",
              tvRoot: status?.steps.paths.tvRoot ?? "",
            }}
            onDone={() => {
              refetch();
              setCurrent("qbit");
            }}
            onBack={() => setCurrent("welcome")}
          />
        )}
        {current === "qbit" && (
          <QbitStep
            state={status?.steps.qbit}
            onRetry={() => refetch()}
            onDone={() => setCurrent("categories")}
            onBack={() => setCurrent("paths")}
          />
        )}
        {current === "categories" && (
          <CategoriesStep
            state={status?.steps.categories.state}
            onDone={() => {
              refetch();
              setCurrent("hook");
            }}
            onBack={() => setCurrent("qbit")}
          />
        )}
        {current === "hook" && (
          <HookStep
            onDone={async () => {
              await fetch("/api/setup/complete", { method: "POST" });
              await refetch();
              qc.invalidateQueries({ queryKey: ["setup-status"] });
              setCurrent("done");
            }}
            onBack={() => setCurrent("categories")}
          />
        )}
        {current === "done" && (
          <DoneStep
            onSearch={() => router.push("/search")}
            onDashboard={() => router.push("/")}
          />
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Subcomponents
// =============================================================================

function Stepper({ current, status }: { current: StepId; status?: StatusResp }) {
  const t = useT();
  return (
    <div className="flex items-center gap-1.5 text-xs">
      {STEPS.map((s, i) => {
        const isActive = s.id === current;
        const stepState = status?.steps[s.id as keyof typeof status.steps]?.state ?? "pending";
        const reached = STEPS.findIndex((x) => x.id === current) >= i;
        return (
          <div key={s.id} className="flex items-center gap-1.5 flex-1">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center border ${
                isActive
                  ? "bg-accent/15 border-accent text-accent"
                  : stepState === "ok"
                    ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400"
                    : reached
                      ? "border-muted/50 text-muted"
                      : "border-border text-muted/50"
              }`}
            >
              {stepState === "ok" && !isActive ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <s.icon className="w-3.5 h-3.5" />
              )}
            </div>
            <span className={`hidden sm:inline ${isActive ? "text-white" : "text-muted"}`}>
              {t(s.key)}
            </span>
            {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-surface border border-border rounded-lg p-6 ${className}`}>{children}</div>
  );
}

function Welcome({ onStart }: { onStart: () => void }) {
  const t = useT();
  return (
    <Card>
      <h2 className="text-xl font-semibold mb-3">{t("setup.welcomeHeading")}</h2>
      <p className="text-sm text-muted mb-6">{t("setup.welcomeBody")}</p>
      <div className="flex gap-3">
        <button
          onClick={onStart}
          className="px-4 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90"
        >
          {t("setup.start")}
        </button>
      </div>
    </Card>
  );
}

function PathsStep({
  initial,
  onDone,
  onBack,
}: {
  initial: { moviesRoot: string; tvRoot: string };
  onDone: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const [movies, setMovies] = useState(initial.moviesRoot);
  const [tv, setTv] = useState(initial.tvRoot);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  // Helpful default suggestion on first paint
  useEffect(() => {
    if (!movies && !tv) {
      // No prefill — let the user pick. The placeholder shows F:\Medias\... as hint.
    }
  }, [movies, tv]);

  const validate = async () => {
    setBusy(true);
    setErr(null);
    setOk(false);
    try {
      const res = await fetch("/api/setup/check-paths", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moviesRoot: movies.trim(), tvRoot: tv.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.movies?.reason === "folder does not exist" || data.tv?.reason === "folder does not exist") {
          setErr(t("setup.pathsErrorMissing"));
        } else if (data.movies?.reason === "no write access" || data.tv?.reason === "no write access") {
          setErr(t("setup.pathsErrorWrite"));
        } else if (data.volume?.reason) {
          setErr(t("setup.pathsErrorVolume"));
        } else {
          setErr(data.movies?.reason ?? data.tv?.reason ?? "validation failed");
        }
        return;
      }
      setOk(true);
      setTimeout(onDone, 600);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-xl font-semibold mb-2">{t("setup.pathsHeading")}</h2>
      <p className="text-sm text-muted mb-6">{t("setup.pathsBody")}</p>

      <div className="space-y-4">
        <div>
          <label className="block text-xs text-muted mb-1">{t("setup.moviesLabel")}</label>
          <input
            value={movies}
            onChange={(e) => setMovies(e.target.value)}
            placeholder="F:\Medias\movies"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">{t("setup.tvLabel")}</label>
          <input
            value={tv}
            onChange={(e) => setTv(e.target.value)}
            placeholder="F:\Medias\tvshows"
            className="w-full bg-bg border border-border rounded-md px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      {err && (
        <div className="mt-4 flex gap-2 text-sm text-rose-400">
          <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}
      {ok && (
        <div className="mt-4 flex gap-2 text-sm text-emerald-400">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t("setup.pathsOk")}</span>
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button
          onClick={onBack}
          className="px-3 py-2 rounded-md text-muted text-sm hover:text-white"
        >
          {t("setup.back")}
        </button>
        <button
          onClick={validate}
          disabled={busy || !movies.trim() || !tv.trim()}
          className="px-4 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {t("setup.pathsValidate")}
        </button>
      </div>
    </Card>
  );
}

function QbitStep({
  state,
  onRetry,
  onDone,
  onBack,
}: {
  state?: { state: StepState; detail?: string };
  onRetry: () => void;
  onDone: () => void;
  onBack: () => void;
}) {
  const t = useT();
  return (
    <Card>
      <h2 className="text-xl font-semibold mb-2">{t("setup.qbitHeading")}</h2>
      <p className="text-sm text-muted mb-6">{t("setup.qbitBody")}</p>

      {state?.state === "ok" && (
        <div className="flex gap-2 text-sm text-emerald-400 mb-4">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{t("setup.qbitOk")}</span>
        </div>
      )}
      {state?.state === "error" && (
        <div className="flex gap-2 text-sm text-rose-400 mb-4">
          <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{state.detail ?? t("setup.qbitError", { url: "qBit" })}</span>
        </div>
      )}
      {state?.state === "pending" && (
        <div className="flex gap-2 text-sm text-muted mb-4">
          <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" />
          <span>Checking...</span>
        </div>
      )}

      <a
        href="/settings/download-client"
        target="_blank"
        className="text-xs text-accent hover:underline"
      >
        {t("setup.qbitOpenSettings")} ↗
      </a>

      <div className="flex justify-between mt-6">
        <button
          onClick={onBack}
          className="px-3 py-2 rounded-md text-muted text-sm hover:text-white"
        >
          {t("setup.back")}
        </button>
        <div className="flex gap-2">
          <button
            onClick={onRetry}
            className="px-3 py-2 rounded-md text-sm border border-border hover:bg-white/5 flex items-center gap-2"
          >
            <RefreshCw className="w-4 h-4" />
            {t("setup.retry")}
          </button>
          <button
            onClick={onDone}
            disabled={state?.state !== "ok"}
            className="px-4 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t("setup.next")}
          </button>
        </div>
      </div>
    </Card>
  );
}

function CategoriesStep({
  state,
  onDone,
  onBack,
}: {
  state?: StepState;
  onDone: () => void;
  onBack: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(state === "ok");

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/setup/qbit-categories", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "failed");
      setOk(true);
      setTimeout(onDone, 600);
    } catch (e: any) {
      setErr(t("setup.categoriesError", { detail: e.message }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-xl font-semibold mb-2">{t("setup.categoriesHeading")}</h2>
      <p className="text-sm text-muted mb-4">{t("setup.categoriesBody")}</p>

      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-bg border border-border rounded-md p-3">
          <div className="text-xs text-muted">Movies</div>
          <code className="text-sm">substitutarr-movies</code>
        </div>
        <div className="bg-bg border border-border rounded-md p-3">
          <div className="text-xs text-muted">TV</div>
          <code className="text-sm">substitutarr-tv</code>
        </div>
      </div>

      {ok && (
        <div className="flex gap-2 text-sm text-emerald-400 mb-4">
          <Check className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{state === "ok" ? t("setup.categoriesAlreadyOk") : t("setup.categoriesOk")}</span>
        </div>
      )}
      {err && (
        <div className="flex gap-2 text-sm text-rose-400 mb-4">
          <CircleAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{err}</span>
        </div>
      )}

      <div className="flex justify-between mt-6">
        <button
          onClick={onBack}
          className="px-3 py-2 rounded-md text-muted text-sm hover:text-white"
        >
          {t("setup.back")}
        </button>
        <div className="flex gap-2">
          {!ok ? (
            <button
              onClick={create}
              disabled={busy}
              className="px-4 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90 disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              {busy ? t("setup.categoriesCreating") : t("setup.categoriesCreate")}
            </button>
          ) : (
            <button
              onClick={onDone}
              className="px-4 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90"
            >
              {t("setup.next")}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function HookStep({ onDone, onBack }: { onDone: () => void; onBack: () => void }) {
  const t = useT();
  const installPath = "C:\\substitutarr\\post-dl.ps1";
  const qbCommand = `powershell.exe -ExecutionPolicy Bypass -File "${installPath}" "%F" "%N" "%I" "%L" "%G" "%R"`;
  const [copied, setCopied] = useState<"qb" | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const copy = async (text: string, kind: "qb") => {
    await navigator.clipboard.writeText(text);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0">
            <Check className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="text-xl font-semibold mb-2">{t("setup.hookSimpleHeading")}</h2>
            <p className="text-sm text-muted mb-3">{t("setup.hookSimpleBody")}</p>
            <ul className="text-sm text-muted space-y-1.5 list-disc pl-5">
              <li>{t("setup.hookSimplePoint1")}</li>
              <li>{t("setup.hookSimplePoint2")}</li>
              <li>{t("setup.hookSimplePoint3")}</li>
            </ul>
          </div>
        </div>
      </Card>

      <div className="bg-surface border border-border rounded-lg">
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full px-5 py-3 text-left text-sm text-muted hover:text-white flex items-center justify-between"
        >
          <span>{t("setup.hookAdvancedToggle")}</span>
          <span className="text-xs">{showAdvanced ? "−" : "+"}</span>
        </button>
        {showAdvanced && (
          <div className="px-5 pb-5 space-y-4 border-t border-border pt-4">
            <p className="text-xs text-muted">{t("setup.hookAdvancedBody")}</p>

            <div>
              <h4 className="text-xs uppercase text-muted/70 mb-2">1. {t("setup.hookCard1Title")}</h4>
              <a
                href="/api/setup/post-dl-script"
                download="post-dl.ps1"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border text-xs hover:bg-white/5"
              >
                <Download className="w-3 h-3" />
                {t("setup.hookCard1Action")}
              </a>
              <p className="text-xs text-muted mt-2">{t("setup.hookCard2Body", { path: installPath })}</p>
            </div>

            <div>
              <h4 className="text-xs uppercase text-muted/70 mb-2">2. {t("setup.hookCard3Title")}</h4>
              <div className="relative">
                <pre className="bg-bg border border-border rounded-md px-3 py-2 text-xs font-mono overflow-x-auto pr-20">
                  {qbCommand}
                </pre>
                <button
                  onClick={() => copy(qbCommand, "qb")}
                  className="absolute top-2 right-2 px-2 py-1 text-xs rounded bg-surface border border-border hover:bg-white/5 flex items-center gap-1"
                >
                  <Copy className="w-3 h-3" />
                  {copied === "qb" ? t("setup.hookCard3Copied") : t("setup.hookCard3Copy")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-3 py-2 rounded-md text-muted text-sm hover:text-white"
        >
          {t("setup.back")}
        </button>
        <button
          onClick={onDone}
          className="px-4 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90"
        >
          {t("setup.next")}
        </button>
      </div>
    </div>
  );
}

function DoneStep({ onSearch, onDashboard }: { onSearch: () => void; onDashboard: () => void }) {
  const t = useT();
  return (
    <Card className="text-center">
      <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center">
        <Check className="w-7 h-7" />
      </div>
      <h2 className="text-xl font-semibold mb-2">{t("setup.doneHeading")}</h2>
      <p className="text-sm text-muted mb-6 max-w-md mx-auto">{t("setup.doneBody")}</p>
      <div className="flex gap-3 justify-center">
        <button
          onClick={onDashboard}
          className="px-4 py-2 rounded-md border border-border text-sm hover:bg-white/5"
        >
          {t("setup.doneGoDashboard")}
        </button>
        <button
          onClick={onSearch}
          className="px-4 py-2 rounded-md bg-accent text-white font-medium hover:bg-accent/90"
        >
          {t("setup.doneTrySearch")}
        </button>
      </div>
    </Card>
  );
}
