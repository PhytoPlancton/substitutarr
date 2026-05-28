"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { UserButton } from "@clerk/nextjs";
import {
  LayoutDashboard,
  Search,
  Film,
  Download,
  SlidersHorizontal,
  HardDriveDownload,
  Server,
  FolderTree,
  Rss,
  KeyRound,
  Tv,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ComponentType } from "react";
import { useT } from "@/lib/i18n/I18nProvider";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";

type DotKind = "red" | "amber" | null;

type Item = {
  href: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
  /** Returns the dot to show: red = error/missing config, amber = stale/never tested, null = healthy/no dot. */
  statusDot?: (ctx: SidebarStatus) => DotKind;
};

type Section = { headerKey: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    headerKey: "nav.entertainment",
    items: [
      { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { href: "/search", labelKey: "nav.search", icon: Search },
      { href: "/library", labelKey: "nav.library", icon: Film },
      { href: "/downloads", labelKey: "nav.downloads", icon: Download },
    ],
  },
  {
    headerKey: "nav.settings",
    items: [
      { href: "/settings/profiles", labelKey: "nav.profiles", icon: SlidersHorizontal },
      {
        href: "/settings/download-client",
        labelKey: "nav.downloadClient",
        icon: HardDriveDownload,
        statusDot: (s) => {
          if (!s.qbitConfigured) return "red";
          if (s.qbitHealth === "error") return "red";
          if (s.qbitHealth === "stale" || s.qbitHealth === "unknown") return "amber";
          return null;
        },
      },
      {
        href: "/settings/indexers",
        labelKey: "nav.indexers",
        icon: Rss,
        statusDot: (s) => {
          if (!s.hasIndexer) return "red";
          if (s.anyIndexerError) return "red";
          if (s.anyIndexerUntested) return "amber";
          return null;
        },
      },
      {
        href: "/settings/library-server",
        labelKey: "nav.libraryServer",
        icon: Server,
        statusDot: (s) => {
          if (!s.jellyfinConfigured) return null; // optional
          if (s.jellyfinHealth === "error") return "red";
          if (s.jellyfinHealth === "stale" || s.jellyfinHealth === "unknown") return "amber";
          return null;
        },
      },
      { href: "/settings/paths", labelKey: "nav.paths", icon: FolderTree },
      { href: "/settings/retention", labelKey: "nav.retention", icon: Trash2 },
      { href: "/settings/api-keys", labelKey: "nav.apiKeys", icon: KeyRound },
    ],
  },
];

type SidebarStatus = {
  qbitConfigured: boolean;
  hasIndexer: boolean;
  jellyfinConfigured: boolean;
  qbitHealth: "unknown" | "connected" | "error" | "stale";
  jellyfinHealth: "unknown" | "connected" | "error" | "stale";
  anyIndexerError: boolean;
  anyIndexerUntested: boolean;
};

export function Sidebar({ authEnabled = true }: { authEnabled?: boolean }) {
  const path = usePathname();
  const t = useT();

  const { data: settings } = useQuery<{ settings: any }>({
    queryKey: ["settings"],
    queryFn: async () => (await fetch("/api/settings")).json(),
  });
  const { data: indexers } = useQuery<{ items: any[] }>({
    queryKey: ["indexers"],
    queryFn: async () => (await fetch("/api/indexers")).json(),
  });
  const { data: health } = useQuery<{ services: Record<string, any> }>({
    queryKey: ["health-services"],
    queryFn: async () => (await fetch("/api/health/services")).json(),
    refetchInterval: 30_000,
  });
  const { data: setupStatus } = useQuery<{ setupComplete: boolean }>({
    queryKey: ["setup-status"],
    queryFn: async () => (await fetch("/api/setup/status")).json(),
    refetchInterval: 60_000,
  });

  const services = health?.services ?? {};
  const enabledIndexers = (indexers?.items ?? []).filter((i) => i.enabled !== false);
  const indexerHealths = enabledIndexers.map((i) => services[`indexer:${i._id}`]);
  const status: SidebarStatus = {
    qbitConfigured: !!settings?.settings?.qbittorrent?.url,
    hasIndexer: enabledIndexers.length > 0,
    jellyfinConfigured: !!settings?.settings?.jellyfin?.url,
    qbitHealth: services.qbit?.status ?? "unknown",
    jellyfinHealth: services.jellyfin?.status ?? "unknown",
    anyIndexerError: indexerHealths.some((h) => h?.status === "error"),
    anyIndexerUntested:
      enabledIndexers.length > 0 &&
      indexerHealths.some((h) => !h || h.status === "unknown" || h.status === "stale"),
  };

  return (
    <aside className="w-60 border-r border-border bg-surface px-4 py-6 flex flex-col">
      <div className="flex items-center gap-2 px-2 mb-8">
        <Tv className="w-6 h-6 text-accent" />
        <span className="font-semibold tracking-tight">substitutarr</span>
      </div>

      <nav className="flex-1 flex flex-col">
        {/* Setup wizard CTA — visible until the user finishes the wizard. After
            that it's hidden but still reachable at /setup for re-runs. */}
        {setupStatus && !setupStatus.setupComplete && (
          <Link
            href="/setup"
            className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm mb-3 border ${
              path === "/setup" || path?.startsWith("/setup/")
                ? "bg-accent/15 text-accent border-accent/40"
                : "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/15"
            }`}
          >
            <Sparkles className="w-4 h-4" />
            {t("setup.navLabel")}
            <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          </Link>
        )}
        {SECTIONS.map((section, sIdx) => (
          <div key={section.headerKey} className={sIdx === 0 ? "" : "mt-6"}>
            <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
              {t(section.headerKey)}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map(({ href, labelKey, icon: Icon, statusDot }) => {
                const active =
                  href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
                const dot = statusDot?.(status) ?? null;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`relative flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                      active
                        ? "bg-accent/15 text-accent border-l-2 border-accent pl-[10px]"
                        : "text-muted hover:text-white hover:bg-white/5 border-l-2 border-transparent pl-[10px]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {t(labelKey)}
                    {dot && (
                      <span
                        title={dot === "red" ? t("nav.errorDot") : t("nav.untestedDot")}
                        className={`ml-auto w-1.5 h-1.5 rounded-full ${
                          dot === "red" ? "bg-rose-500" : "bg-amber-500"
                        }`}
                      />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-2 pt-4 border-t border-border flex items-center justify-between gap-2">
        {authEnabled ? (
          <UserButton afterSignOutUrl="/sign-in" />
        ) : (
          <div className="text-xs text-muted min-w-0 flex-1">
            <div className="font-medium text-amber-400 truncate">{t("nav.devMode")}</div>
            <div className="truncate">{t("nav.devModeDetail")}</div>
          </div>
        )}
        <LocaleSwitcher />
      </div>
    </aside>
  );
}
