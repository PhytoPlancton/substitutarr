import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { getUserQbit } from "@/lib/qbittorrent";

export const runtime = "nodejs";

const Schema = z.object({
  /** When true, enables instant imports. When false, clears the autorun. */
  enabled: z.boolean(),
  /** Override the URL substitutarr publishes for qBit to call. Defaults to
   *  the host the request came from — works on localhost out of the box. */
  baseUrl: z.string().url().optional(),
});

/**
 * Configure qBit's "Run external program on torrent finished" via the qBit API.
 *
 * When enabled, qBit will call substitutarr the instant a torrent completes:
 *   curl.exe -s -m 30 "<base>/api/qbit-finished?hash=%I&category=%L&path=%F&name=%N"
 *
 * The user doesn't have to touch qBit's Tools -> Options -> Downloads UI.
 * Disabling clears the autorun_program (back to 60s polling-only).
 */
export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = Schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const url = new URL(req.url);
  const base = parsed.data.baseUrl ?? `${url.protocol}//${url.host}`;
  const target = `${base.replace(/\/$/, "")}/api/qbit-finished?hash=%I&category=%L&path=%F&name=%N`;

  // Use curl.exe — bundled with Windows 10+ and on every Linux/macOS by default.
  // Quoting: the whole "C:\Windows\System32\curl.exe ... %F" string is wrapped
  // in qBit's own escaping, which expects double quotes around the URL.
  const command = process.platform === "win32"
    ? `"C:\\Windows\\System32\\curl.exe" -s -m 30 "${target}"`
    : `curl -s -m 30 "${target}"`;

  try {
    const qb = await getUserQbit(userId);
    if (parsed.data.enabled) {
      await qb.setPreferences({
        autorun_enabled: true,
        autorun_program: command,
      });
      return NextResponse.json({ ok: true, enabled: true, command });
    }
    await qb.setPreferences({
      autorun_enabled: false,
      autorun_program: "",
    });
    return NextResponse.json({ ok: true, enabled: false });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}

/** Read current state — does qBit's autorun currently point at substitutarr ? */
export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const qb = await getUserQbit(userId);
    const prefs = await qb.getPreferences();
    const enabled =
      !!prefs.autorun_enabled &&
      typeof prefs.autorun_program === "string" &&
      prefs.autorun_program.includes("/api/qbit-finished");
    return NextResponse.json({
      enabled,
      qbitAutorunEnabled: !!prefs.autorun_enabled,
      qbitAutorunProgram: prefs.autorun_program ?? "",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 502 });
  }
}
