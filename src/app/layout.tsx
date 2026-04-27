import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { QueryProvider } from "@/components/QueryProvider";
import { Sidebar } from "@/components/Sidebar";
import { clerkConfigured } from "@/lib/auth";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { getServerLocale } from "@/lib/i18n/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "substitutarr",
  description: "Unified media automation — search, monitor, download, organize.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const enabled = clerkConfigured();
  const locale = await getServerLocale();
  const shell = (
    <html lang={locale}>
      <body className="min-h-screen bg-bg text-white">
        <I18nProvider initialLocale={locale}>
          <QueryProvider>
            <div className="flex min-h-screen">
              <Sidebar authEnabled={enabled} />
              <main className="flex-1 px-8 py-6">{children}</main>
            </div>
          </QueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
  return enabled ? <ClerkProvider>{shell}</ClerkProvider> : shell;
}
