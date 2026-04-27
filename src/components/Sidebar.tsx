"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { Home, Search, Library, Download, Settings, Tv, SlidersHorizontal } from "lucide-react";

const items = [
  { href: "/", label: "Dashboard", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Library", icon: Library },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/profiles", label: "Profiles", icon: SlidersHorizontal },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ authEnabled = true }: { authEnabled?: boolean }) {
  const path = usePathname();
  return (
    <aside className="w-60 border-r border-border bg-surface px-4 py-6 flex flex-col">
      <div className="flex items-center gap-2 px-2 mb-8">
        <Tv className="w-6 h-6 text-accent" />
        <span className="font-semibold tracking-tight">substitutarr</span>
      </div>
      <nav className="flex-1 flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = path === href || (href !== "/" && path.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                active ? "bg-accent/15 text-accent" : "text-muted hover:text-white hover:bg-white/5"
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          );
        })}
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
