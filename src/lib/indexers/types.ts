export type SearchInput = {
  type: "movie" | "tv";
  title: string;
  year?: number;
  imdbId?: string;
  tmdbId?: number;
  season?: number;
  episode?: number;
};

export type Release = {
  title: string;
  magnet?: string;
  url?: string;
  infoHash?: string;
  sizeBytes?: number;
  seeders?: number;
  leechers?: number;
  quality?: string;
  source?: string;
  indexer: string;
  publishedAt?: string;
  score?: number;
};

export interface Indexer {
  name: string;
  kind: string;
  search(input: SearchInput): Promise<Release[]>;
}
