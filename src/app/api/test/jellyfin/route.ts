import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordHealth } from "@/lib/connection-health";

export const runtime = "nodejs";

const Schema = z.object({
  url: z.string().url(),
  apiKey: z.string().min(1),
});

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, title: "Invalid input", detail: "URL and API key are required." },
      { status: 200 },
    );
  }

  const start = Date.now();
  const base = parsed.data.url.replace(/\/$/, "");
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`${base}/System/Info`, {
      headers: { "X-Emby-Token": parsed.data.apiKey },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const detail = `HTTP ${res.status}${res.status === 401 ? " — invalid API key" : ""}`;
      await recordHealth({ userId, service: "jellyfin", ok: false, latencyMs, detail });
      return NextResponse.json({ ok: false, title: "Jellyfin error", detail });
    }
    const info: any = await res.json();
    const detail = `Jellyfin ${info.Version ?? "?"} on ${info.OperatingSystemDisplayName ?? info.OperatingSystem ?? "?"}`;
    await recordHealth({ userId, service: "jellyfin", ok: true, latencyMs, detail });
    return NextResponse.json({ ok: true, title: detail, latencyMs });
  } catch (e: any) {
    const latencyMs = Date.now() - start;
    const detail = e.name === "AbortError" ? "Timeout after 10s" : e.message ?? String(e);
    await recordHealth({ userId, service: "jellyfin", ok: false, latencyMs, detail });
    return NextResponse.json({ ok: false, title: "Jellyfin unreachable", detail });
  }
}
