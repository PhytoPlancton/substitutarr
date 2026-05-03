import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getUserId } from "@/lib/auth";
import { connectMongo } from "@/lib/mongo";
import { UserSettings } from "@/models/UserSettings";

export const runtime = "nodejs";

/**
 * Generate the configured post-dl.ps1 by substituting placeholders in the
 * template. Returns it as a download (Content-Disposition: attachment) so
 * the user just clicks → save → done.
 *
 * Placeholders: {{MOVIES_ROOT}}, {{TV_ROOT}}, {{HMAC_SECRET}}, {{SUBSTITUTARR_URL}}.
 *
 * The HMAC secret is embedded in cleartext in the file the user saves locally.
 * That's fine — it's a per-instance secret living on the same machine as the
 * substitutarr process. We add a header comment warning not to share it.
 */
export async function GET(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await connectMongo();
  const s = (await UserSettings.findOne({ userId }).lean()) as any;
  const moviesRoot = s?.libraryPaths?.movies?.trim();
  const tvRoot = s?.libraryPaths?.tv?.trim();
  if (!moviesRoot || !tvRoot) {
    return NextResponse.json({ error: "library paths not configured" }, { status: 400 });
  }

  const secret = process.env.POSTPROCESS_HMAC_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "POSTPROCESS_HMAC_SECRET not set on server" }, { status: 500 });
  }

  // Best-effort base URL: prefer the request's origin so the script knows
  // exactly where to call back. The user can override later if they put
  // substitutarr behind a tunnel/proxy.
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  // Read the template from the repo. In Vercel-style deploys, the file lives
  // alongside the build; in PM2/local it's at <cwd>/scripts/post-dl.ps1.
  const candidates = [
    path.join(process.cwd(), "scripts", "post-dl.ps1"),
    path.join(process.cwd(), "..", "scripts", "post-dl.ps1"),
  ];
  let template: string | null = null;
  for (const c of candidates) {
    try {
      template = fs.readFileSync(c, "utf8");
      break;
    } catch {
      /* try next */
    }
  }
  if (!template) {
    return NextResponse.json({ error: "post-dl.ps1 template missing on server" }, { status: 500 });
  }

  // Escape single quotes for PowerShell single-quoted string syntax: '' = literal '
  const psEscape = (s: string) => s.replace(/'/g, "''");

  const filled = template
    .replace(/\{\{MOVIES_ROOT\}\}/g, psEscape(moviesRoot))
    .replace(/\{\{TV_ROOT\}\}/g, psEscape(tvRoot))
    .replace(/\{\{HMAC_SECRET\}\}/g, psEscape(secret))
    .replace(/\{\{SUBSTITUTARR_URL\}\}/g, psEscape(baseUrl));

  const banner = `# DOWNLOADED FROM substitutarr — DO NOT SHARE THIS FILE.
# It contains your per-instance HMAC secret in cleartext.
# Generated for user ${userId} at ${new Date().toISOString()}.

`;

  return new NextResponse(banner + filled, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="post-dl.ps1"`,
      "Cache-Control": "no-store",
    },
  });
}
