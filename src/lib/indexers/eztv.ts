import type { Indexer, Release, SearchInput } from "./types";
import { parseQuality } from "./quality";

export class EztvIndexer implements Indexer {
  name = "EZTV";
  kind = "eztv";
  constructor(private base: string = "https://eztvx.to/api") {}

  async search(input: SearchInput): Promise<Release[]> {
    if (input.type !== "tv") return [];
    if (!input.imdbId) return [];

    const imdb = input.imdbId.replace(/^tt/, "");
    const url = `${this.base}/get-torrents?imdb_id=${imdb}&limit=100`;
    const res = await fetch(url, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data: any = await res.json();
    const list: any[] = data?.torrents ?? [];

    return list
      .filter((t) => {
        if (input.season && t.season && Number(t.season) !== input.season) return false;
        if (input.episode && t.episode && Number(t.episode) !== input.episode) return false;
        return true;
      })
      .map((t) => {
        const q = parseQuality(t.title);
        return {
          title: t.title,
          magnet: t.magnet_url,
          infoHash: t.hash,
          sizeBytes: Number(t.size_bytes) || undefined,
          seeders: t.seeds,
          leechers: t.peers,
          quality: q.quality,
          indexer: this.name,
          publishedAt: t.date_released_unix
            ? new Date(t.date_released_unix * 1000).toISOString()
            : undefined,
        } satisfies Release;
      });
  }
}
