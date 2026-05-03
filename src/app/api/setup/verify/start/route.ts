import { NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createVerifyToken } from "@/lib/setup-tokens";

export const runtime = "nodejs";

/**
 * Generate a one-shot verify token + the exact PowerShell command the user
 * pastes to test their hook config. The token expires in 90s.
 */
export async function POST() {
  const userId = await getUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const token = createVerifyToken(userId);
  const command = `powershell.exe -ExecutionPolicy Bypass -File "C:\\substitutarr\\post-dl.ps1" -TestMode -VerifyToken ${token}`;
  return NextResponse.json({ token, command, ttlSeconds: 90 });
}
