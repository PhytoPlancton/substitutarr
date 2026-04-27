"use client";
import { useState } from "react";
import { Loader2, Plug, AlertCircle, Check } from "lucide-react";
import type { ConnStatus } from "./StatusDot";

export type TestResult = { ok: boolean; title?: string; detail?: string };

/** Min display time so a 80ms test doesn't flash. */
const MIN_SPINNER_MS = 400;

async function withMinDelay<T>(p: Promise<T>): Promise<T> {
  const start = Date.now();
  const r = await p;
  const left = MIN_SPINNER_MS - (Date.now() - start);
  if (left > 0) await new Promise((res) => setTimeout(res, left));
  return r;
}

export function TestSaveButtons({
  onTest,
  onSave,
  disabled,
  onStatus,
}: {
  /** Should call the test API and resolve with the result. */
  onTest: () => Promise<TestResult>;
  /** Should call the save API. Receives the latest test result so saves only
   *  happen if the test passed (handled internally — onSave is only called
   *  when the test was OK). */
  onSave: () => Promise<void>;
  disabled?: boolean;
  /** Optional callback to push status to the parent (for the page header dot). */
  onStatus?: (s: ConnStatus, result: TestResult | null) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const runTest = async (): Promise<TestResult> => {
    onStatus?.("testing", null);
    const r = await withMinDelay(onTest());
    setResult(r);
    onStatus?.(r.ok ? "connected" : "error", r);
    return r;
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await runTest();
    } finally {
      setTesting(false);
    }
  };

  const handleTestSave = async () => {
    setSaving(true);
    try {
      const r = await runTest();
      if (!r.ok) return;
      await onSave();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const isPending = testing || saving;

  return (
    <div className="space-y-3">
      {result?.ok === false && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-3">
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-rose-300">{result.title ?? "Connection failed"}</p>
              {result.detail && (
                <p className="mt-1 font-mono text-xs text-rose-400/80 break-all">{result.detail}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {savedFlash && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center gap-2 text-sm text-emerald-300">
          <Check className="h-4 w-4" /> Tested + saved successfully.
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button
          type="button"
          onClick={handleTest}
          disabled={isPending || disabled}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5 text-sm font-medium hover:bg-white/5 disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          Test connection
        </button>
        <button
          type="button"
          onClick={handleTestSave}
          disabled={isPending || disabled}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Test &amp; save
        </button>
      </div>
    </div>
  );
}
