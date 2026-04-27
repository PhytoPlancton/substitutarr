import { auth } from "@clerk/nextjs/server";

export function clerkConfigured(): boolean {
  const k = process.env.CLERK_SECRET_KEY;
  return !!k && k.startsWith("sk_");
}

/**
 * Returns the current user id.
 *  - In production with Clerk configured → real Clerk userId or null.
 *  - When CLERK_SECRET_KEY is missing/placeholder → returns "dev-user" so
 *    the app is fully usable locally without an auth round-trip.
 */
export async function getUserId(): Promise<string | null> {
  if (!clerkConfigured()) return "dev-user";
  try {
    const { userId } = await auth();
    return userId ?? null;
  } catch {
    return null;
  }
}
