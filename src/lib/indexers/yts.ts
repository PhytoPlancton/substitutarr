import type { Indexer, Release, SearchInput } from "./types";
import { parseQuality } from "./quality";

const TRACKERS = [
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.openbittorrent.com:80",
  "udp://tracker.coppersurfer.tk:6969",
  "udp://glotorrents.pw:6969/announce",
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://torrent.gresille.org:80/announce",
  "udp://p4p.arenabg.com:1337",
  "udp://tracker.leechers-paradise.org:6969",
];

const buildMagnet = (hash: string, name: string) =>
  `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}` +
  TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join("");

export class YtsIndexer implements Indexer {
  name = "YTS";
  kind = "yts";
  constructor(private base: string = "https://yts.mx/api/v2") {}

  async search(input: SearchInput): Promise<Release[]> {
    if (input.type !== "movie") return [];
    const qs = new URLSearchParams({
      query_term: input.title,
      limit: "20",
      sort_by: "seeds",
      order_by: "desc",
    });
    const res = await fetch(`${this.base}/list_movies.json?${qs}`, { next: { revalidate: 300 } });
    if (!res.ok) return [];
    const data: any = await res.json();
    const movies: any[] = data?.data?.movies ?? [];
    const releases: Release[] = [];
    for (const m of movies) {
      if (input.year && m.year && Math.abs(m.year - input.year) > 1) continue;
      for (const t of m.torrents || []) {
        const title = `${m.title} (${m.year}) [${t.quality}] [${t.type}] [YTS]`;
        const q = parseQuality(title);
        releases.push({
          title,
          magnet: buildMagnet(t.hash, title),
          infoHash: t.hash,
          sizeBytes: t.size_bytes,
          seeders: t.seeds,
          leechers: t.peers,
          quality: q.quality ?? t.quality,
          source: t.type,
          indexer: this.name,
          publishedAt: t.date_uploaded,
        });
      }
    }
    return releases;
  }
}
