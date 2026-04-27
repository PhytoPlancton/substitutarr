"use client";
import { useLocale } from "@/lib/i18n/I18nProvider";
import type { Locale } from "@/lib/i18n/dictionaries";

const LOCALES: Locale[] = ["en", "fr"];

export function LocaleSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <div
      role="group"
      aria-label="Language"
      className="inline-flex items-center rounded-md border border-border bg-bg/60 p-0.5 text-[10px] font-medium"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          onClick={() => setLocale(l)}
          aria-pressed={locale === l}
          className={`px-1.5 py-0.5 rounded transition-colors uppercase tracking-wide ${
            locale === l
              ? "bg-surface text-white shadow-sm"
              : "text-muted hover:text-white"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
