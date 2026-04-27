import type { EpisodeStatus, MonitoringStrategy } from "@/models/Media";

/**
 * Compute the initial status for an episode based on whether it has aired.
 * Status is then refined by monitoring + grab/import flow.
 */
export function initialEpisodeStatus(airDate?: string | null): EpisodeStatus {
  if (!airDate) return "wanted";
  // Compare just YYYY-MM-DD lexicographically (no timezone hell)
  const today = new Date().toISOString().slice(0, 10);
  return airDate > today ? "unaired" : "wanted";
}

/**
 * Apply a monitoring strategy to a freshly-hydrated `seasons[]` from TMDB.
 * Returns a new seasons array with `monitored` and per-episode `monitored`
 * + `status` set according to the strategy. Mutates inputs is fine — they're
 * created from TMDB.
 */
export function applyMonitoringStrategy(
  seasons: any[],
  strategy: MonitoringStrategy,
): any[] {
  if (!Array.isArray(seasons) || seasons.length === 0) return [];

  // Find latest non-special season for "lastSeason" / "recent"
  const latestSeasonNum = Math.max(
    ...seasons.filter((s) => (s.number ?? 0) > 0).map((s) => s.number ?? 0),
    0,
  );

  return seasons.map((s) => {
    const isSpecials = (s.number ?? 0) === 0;
    const seasonMonitored = (() => {
      if (isSpecials) return false; // Specials default off — Sonarr convention
      switch (strategy) {
        case "all": return true;
        case "future": return true; // we'll toggle per-episode below
        case "missing": return true;
        case "existing": return true; // toggle per-ep
        case "firstSeason": return s.number === 1;
        case "lastSeason": return s.number === latestSeasonNum;
        case "pilot": return s.number === 1;
        case "recent": return s.number === latestSeasonNum;
        case "none": return false;
      }
    })();

    const episodes = (s.episodes ?? []).map((e: any) => {
      const baseStatus = initialEpisodeStatus(e.airDate);
      const epMonitored = (() => {
        if (!seasonMonitored) return false;
        switch (strategy) {
          case "all": return true;
          case "future": return baseStatus === "unaired";
          case "missing": return baseStatus === "wanted"; // future remain monitored too
          case "existing": return false; // no files yet on add
          case "firstSeason": return s.number === 1;
          case "lastSeason": return s.number === latestSeasonNum;
          case "pilot": return s.number === 1 && e.number === 1;
          case "recent": return s.number === latestSeasonNum;
          case "none": return false;
        }
      })();

      return {
        ...e,
        monitored: epMonitored,
        status: epMonitored ? baseStatus : "unmonitored",
      };
    });

    return { ...s, monitored: seasonMonitored, episodes };
  });
}

/** Roll-up stats from episodes for a season. */
export function seasonStats(season: any) {
  const eps: any[] = season?.episodes ?? [];
  const total = eps.length;
  let downloaded = 0,
    wanted = 0,
    unaired = 0,
    snatched = 0,
    missing = 0,
    unmonitored = 0,
    downloading = 0;
  for (const e of eps) {
    switch (e.status) {
      case "downloaded": downloaded++; break;
      case "wanted": wanted++; break;
      case "unaired": unaired++; break;
      case "snatched": snatched++; break;
      case "downloading": downloading++; break;
      case "missing": missing++; break;
      case "unmonitored": unmonitored++; break;
    }
  }
  const aired = total - unaired - unmonitored;
  return { total, downloaded, wanted, unaired, snatched, missing, unmonitored, downloading, aired };
}

/** Roll-up stats for the whole series. */
export function seriesStats(seasons: any[]) {
  const all = (seasons ?? []).reduce(
    (acc, s) => {
      const st = seasonStats(s);
      acc.totalEp += st.total;
      acc.downloaded += st.downloaded;
      acc.wanted += st.wanted;
      acc.unaired += st.unaired;
      acc.missing += st.missing;
      acc.downloading += st.downloading;
      acc.snatched += st.snatched;
      acc.unmonitored += st.unmonitored;
      acc.airedTotal += st.aired;
      return acc;
    },
    { totalEp: 0, downloaded: 0, wanted: 0, unaired: 0, missing: 0, downloading: 0, snatched: 0, unmonitored: 0, airedTotal: 0 },
  );
  const monitoredSeasons = (seasons ?? []).filter((s) => s.monitored).length;
  return {
    ...all,
    seasonCount: (seasons ?? []).filter((s) => (s.number ?? 0) > 0).length,
    monitoredSeasons,
  };
}
