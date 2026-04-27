import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { QueryProvider } from "@/components/QueryProvider";
import { Sidebar } from "@/components/Sidebar";
import { clerkConfigured } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "substitutarr",
  description: "Unified media automation — search, monitor, download, organize.",
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const enabled = clerkConfigured();
  const shell = (
    <html lang="en">
      <body className="min-h-screen bg-bg text-white">
        <QueryProvider>
          <div className="flex min-h-screen">
            <Sidebar authEnabled={enabled} />
            <main className="flex-1 px-8 py-6">{children}</main>
          </div>
        </QueryProvider>
      </body>
    </html>
  );
  return enabled ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
