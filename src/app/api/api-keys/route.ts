import { getUserId } from "@/lib/auth";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createApiKey, listApiKeys, deleteApiKey } from "@/lib/api-keys";

export const runtime = "nodejs";

const CreateSchema = z.object({ name: z.string().min(1).max(60) });

export async function GET() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json({ items: await listApiKeys(userId) });
}

export async function POST(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { plain, meta } = await createApiKey(userId, parsed.data.name);
  // The plain key is returned ONCE — UI must display and remind the user to save it.
  return NextResponse.json({ key: plain, meta });
}

export async function DELETE(req: Request) {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const preview = new URL(req.url).searchParams.get("preview");
  if (!preview) return NextResponse.json({ error: "missing preview" }, { status: 400 });
  await deleteApiKey(userId, preview);
  return NextResponse.json({ ok: true });
}
