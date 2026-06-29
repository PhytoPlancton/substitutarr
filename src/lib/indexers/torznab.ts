import type { Indexer, Release, SearchInput } from "./types";
import { parseQuality } from "./quality";
import { parseStringPromise } from "xml2js";
import { fetchWithCloudflareBypass } from "./cloudflare";

/**
 * Generic Torznab adapter — works with any indexer that exposes the spec
 * (e.g. c411.org/api/torznab, private trackers, etc). No Jackett/Prowlarr involved.
 *
 * The URL the user gives can be either:
 *   - the bare host: https://c411.org           → we append /api/torznab
 *   - the full endpoint: https://c411.org/api/torznab
 *
 * All HTTP calls go through fetchWithCloudflareBypass — UA rotation, session
 * cookie persistence, exponential backoff, and optional FlareSolverr fallback.
 * FrankeinStream's shadow run showed 24/46 failures from C411 returning 5xx or
 * Cloudflare challenges; this is the fix.
 */
export class TorznabIndexer implements Indexer {
  kind = "torznab";
  private endpoint: string;

  constructor(
    public name: string,
    rawUrl: string,
    private apiKey: string,
    private categories?: string[],
  ) {
    const u = rawUrl.replace(/\/+$/, "");
    this.endpoint = /\/(api|torznab)(\/|$)/i.test(u) ? u : `${u}/api/torznab`;
  }

  async search(input: SearchInput): Promise<Release[]> {
    const q =
      input.type === "tv" && input.season
        ? `${input.title} S${String(input.season).padStart(2, "0")}${
            input.episode ? "E" + String(input.episode).padStart(2, "0") : ""
          }`
        : input.year && input.type === "movie"
          ? `${input.title} ${input.year}`
          : input.title;

    // tvsearch / movie are spec-mandated but many FR trackers fall back to
    // generic search. Try the typed endpoint first, fall back to t=search.
    const primaryT = input.type === "tv" ? "tvsearch" : input.type === "movie" ? "movie" : "search";
    const tries: string[] = [primaryT];
    if (primaryT !== "search") tries.push("search");

    let xml: string | null = null;
    let lastError: Error | null = null;
    for (const t of tries) {
      const params = new URLSearchParams({ t, apikey: this.apiKey, q, limit: "50" });
      if (input.tmdbId) params.set("tmdbid", String(input.tmdbId));
      if (input.imdbId) params.set("imdbid", input.imdbId.replace(/^tt/, ""));
      if (input.season) params.set("season", String(input.season));
      if (input.episode) params.set("ep", String(input.episode));
      if (this.categories?.length) params.set("cat", this.categories.join(","));
      try {
        xml = await this.fetchWithRetry(`${this.endpoint}?${params}`);
        if (xml) break;
      } catch (e: any) {
        lastError = e;
      }
    }
    if (!xml) throw lastError ?? new Error("indexer unreachable (Cloudflare 5xx or timeout — rate-limited?)");

    const parsed: any = await parseStringPromise(xml, { explicitArray: false, mergeAttrs: true });
    const items: any[] = [].concat(parsed?.rss?.channel?.item ?? []);

    return items.map((it) => {
      const attrs = [].concat(it["torznab:attr"] ?? it.attr ?? []) as any[];
      const get = (n: string) => attrs.find((a) => a.name === n)?.value;
      const title = it.title ?? "";
      const qual = parseQuality(title);
      // Prefer <enclosure url=...> (the .torrent download) over <link> (page URL)
      const enclosureUrl: string | undefined = it.enclosure?.url;
      const link: string | undefined = it.link;
      const downloadUrl =
        enclosureUrl && !enclosureUrl.startsWith("https://c411.org/torrents/")
          ? enclosureUrl
          : link;
      return {
        title,
        url: downloadUrl?.startsWith("magnet:") ? undefined : downloadUrl,
        magnet: downloadUrl?.startsWith("magnet:") ? downloadUrl : undefined,
        infoHash: get("infohash") || it.guid,
        sizeBytes: Number(it.size ?? it.enclosure?.length) || undefined,
        seeders: Number(get("seeders")) || undefined,
        leechers: Number(get("peers")) || undefined,
        quality: qual.quality,
        indexer: this.name,
        publishedAt: it.pubDate,
      } satisfies Release;
    });
  }

  private async fetchWithRetry(url: string): Promise<string | null> {
    const r = await fetchWithCloudflareBypass(url, { acceptXml: true, timeoutMs: 25_000 });
    if (r.ok) return r.body;
    // Surface a meaningful error to the caller (searchAll aggregates it)
    throw new Error(r.error ?? `indexer unreachable (status ${r.status})`);
  }
}
