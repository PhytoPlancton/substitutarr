import { cookies } from "next/headers";
import type { Locale } from "./dictionaries";

const COOKIE = "ss_locale";

/** Read the locale cookie server-side for the initial render. */
export async function getServerLocale(): Promise<Locale> {
  const c = (await cookies()).get(COOKIE)?.value;
  return c === "fr" ? "fr" : "en";
}
