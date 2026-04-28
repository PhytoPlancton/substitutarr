import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/api-keys";

/**
 * Bearer / X-API-Key auth for `/api/external/*`.
 * Returns either the resolved userId or a NextResponse to short-circuit.
 *
 * All external endpoints require the `external:request` scope today —
 * we may split read/write scopes later, but every key issued so far holds
 * `external:request`, so accepting it everywhere keeps the streaming-site
 * integration zero-config from the user's POV.
 */
export async function authExternal(
  req: Request,
): Promise<{ ok: true; userId: string } | { ok: false; res: NextResponse }> {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(\S+)$/i);
  const token = m?.[1] ?? req.headers.get("x-api-key");
  if (!token)
    return {
      ok: false,
      res: NextResponse.json({ error: "missing API key" }, { status: 401 }),
    };
  const result = await resolveApiKey(token, "external:request");
  if (!result.ok) {
    const status = result.reason === "rate-limited" ? 429 : 401;
    return {
      ok: false,
      res: NextResponse.json({ error: result.message }, { status }),
    };
  }
  return { ok: true, userId: result.data.userId };
}
