import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/api/cron(.*)",
  "/api/external/(.*)", // authenticated via X-API-Key, not Clerk
  "/api/health(.*)",
  "/api/jellyfin/webhook(.*)", // HMAC-verified, not Clerk
  "/api/post-process(.*)", // HMAC-verified from the qBit Windows hook
]);

const clerkConfigured =
  !!process.env.CLERK_SECRET_KEY && process.env.CLERK_SECRET_KEY.startsWith("sk_");

const middleware = clerkConfigured
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) await auth.protect();
    })
  : (_req: NextRequest) => NextResponse.next();

export default middleware;

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
