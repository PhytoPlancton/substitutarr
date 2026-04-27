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
} from "lucide-react";
import type { ComponentType } from "react";

type DotKind = "red" | "amber" | null;

type Item = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Returns the dot to show: red = error/missing config, amber = stale/never tested, null = healthy/no dot. */
  statusDot?: (ctx: SidebarStatus) => DotKind;
};

type Section = { header: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    header: "Entertainment",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/search", label: "Search", icon: Search },
      { href: "/library", label: "Library", icon: Film },
      { href: "/downloads", label: "Downloads", icon: Download },
    ],
  },
  {
    header: "Settings",
    items: [
      { href: "/settings/profiles", label: "Profiles", icon: SlidersHorizontal },
      {
        href: "/settings/download-client",
        label: "Download client",
        icon: HardDriveDownload,
        statusDot: (s) => {
          if (!s.qbitConfigured) return "red";
          if (s.qbitHealth === "error") return "red";
          if (s.qbitHealth === "stale" || s.qbitHealth === "unknown") return "amber";
          return null;
        },
      },
      {
        href: "/settings/library-server",
        label: "Library server",
        icon: Server,
        statusDot: (s) => {
          if (!s.jellyfinConfigured) return null; // optional
          if (s.jellyfinHealth === "error") return "red";
          if (s.jellyfinHealth === "stale" || s.jellyfinHealth === "unknown") return "amber";
          return null;
        },
      },
      { href: "/settings/paths", label: "Paths", icon: FolderTree },
      {
        href: "/settings/indexers",
        label: "Indexers",
        icon: Rss,
        statusDot: (s) => {
          if (!s.hasIndexer) return "red";
          if (s.anyIndexerError) return "red";
          if (s.anyIndexerUntested) return "amber";
          return null;
        },
      },
      { href: "/settings/api-keys", label: "API keys", icon: KeyRound },
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
        {SECTIONS.map((section, sIdx) => (
          <div key={section.header} className={sIdx === 0 ? "" : "mt-6"}>
            <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted/70">
              {section.header}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map(({ href, label, icon: Icon, statusDot }) => {
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
                    {label}
                    {dot && (
                      <span
                        title={dot === "red" ? "Error or missing config" : "Never tested or stale"}
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

      <div className="px-2 pt-4 border-t border-border">
        {authEnabled ? (
          <UserButton afterSignOutUrl="/sign-in" />
        ) : (
          <div className="text-xs text-muted">
            <div className="font-medium text-amber-400">Dev mode</div>
            <div>Set CLERK_SECRET_KEY to enable auth.</div>
          </div>
        )}
      </div>
    </aside>
  );
}
