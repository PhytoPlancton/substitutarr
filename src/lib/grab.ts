import { connectMongo } from "./mongo";
import { Media } from "@/models/Media";
import { Download } from "@/models/Download";
import { UserSettings } from "@/models/UserSettings";
import { Profile } from "@/models/Profile";
import { Activity } from "@/models/Activity";
import { searchAll } from "./indexers/registry";
import { getUserQbit } from "./qbittorrent";
import { ensureProfilesForUser } from "./profile-bootstrap";
import { recordHealth } from "./connection-health";
import { addStrike } from "./blocklist";
import { emit as emitWebhook } from "./webhooks";
import type { Release } from "./indexers/types";

function infoHashFromMagnet(magnet: string): string | undefined {
  return magnet.match(/btih:([a-fA-F0-9]{40})/)?.[1]?.toLowerCase()
    ?? magnet.match(/btih:([a-zA-Z2-7]{32})/)?.[1]?.toLowerCase();
}

function titleFromMagnet(magnet: string): string {
  return decodeURIComponent(magnet.match(/[?&]dn=([^&]+)/)?.[1] ?? "manual magnet");
}

async function pushToQbit(
  userId: string,
  media: any,
  release: Pick<Release, "magnet" | "url" | "title" | "infoHash" | "quality" | "sizeBytes" | "seeders" | "indexer">,
  season?: number,
  episode?: number,
) {
  const settings = await UserSettings.findOne({ userId }).lean<any>();
  const qbit = await getUserQbit(userId);
  // Categories are typed (`substitutarr-movies` / `substitutarr-tv`) so the
  // post-DL PowerShell hook can route to the right library folder.
  const customBase = settings?.qbittorrent?.category;
  const baseCategory = customBase && customBase !== "substitutarr" ? customBase : "substitutarr";
  const category = `${baseCategory}-${media.type === "movie" ? "movies" : "tv"}`;
  // Only override qBit's own default save path if the user explicitly configured one.
  // Otherwise we'd push something like "/downloads/movies" to a Windows host → qBit error.
  const userPath =
    media.type === "movie" ? settings?.paths?.movies?.trim() : settings?.paths?.tv?.trim();
  const savePath = userPath ? userPath : undefined;

  const link = release.magnet ?? release.url;
  if (!link) throw new Error("release has no download URL or magnet");
  try {
    await qbit.add(link, {
      category,
      savePath,
      expectedHash: release.infoHash?.toLowerCase(),
    });
    // Real successful add → mark qBit healthy (avoids requiring an explicit Test click)
    void recordHealth({ userId, service: "qbit", ok: true, detail: "torrent added" });
  } catch (e: any) {
    void recordHealth({
      userId,
      service: "qbit",
      ok: false,
      detail: e?.message ?? String(e),
    });
    // Strike the release so we don't retry the exact same broken torrent.
    // After 3 strikes (across all attempts on this user), it gets blocked for 24h
    // automatically — that prevents tight retry loops on truly-busted releases.
    if (release.infoHash) {
      void addStrike({
        userId,
        infoHash: release.infoHash,
        releaseTitle: release.title,
        indexer: release.indexer,
        mediaId: media._id?.toString(),
        season,
        episode,
      }).catch(() => {});
    }
    throw e;
  }

  await Download.create({
    userId,
    mediaId: media._id,
    indexer: release.indexer,
    title: release.title,
    magnet: release.magnet,
    infoHash: release.infoHash,
    qbHash: release.infoHash,
    quality: release.quality,
    sizeBytes: release.sizeBytes,
    seeders: release.seeders,
    state: "downloading",
    season,
    episode,
  });
  void Activity.create({
    userId,
    mediaId: media._id,
    kind: "grabbed",
    title: release.title,
    season,
    episode,
    indexer: release.indexer,
  }).catch(() => {});

  if (media.type === "tv" && (season != null || episode != null)) {
    // Mark per-episode (or all matching season episodes when no episode passed) as snatched.
    const grabInfo = {
      downloadId: release.infoHash?.toLowerCase(),
      indexer: release.indexer,
      releaseTitle: release.title,
      snatchedAt: new Date(),
    };
    if (episode != null && season != null) {
      await Media.updateOne(
        { _id: media._id, "seasons.number": season },
        {
          $set: {
            "seasons.$[s].episodes.$[e].status": "snatched",
            "seasons.$[s].episodes.$[e].grab": grabInfo,
            lastSearchedAt: new Date(),
          },
        },
        { arrayFilters: [{ "s.number": season }, { "e.number": episode }] },
      );
    } else if (season != null) {
      // Season pack — apply to every episode in the season that doesn't already have a file.
      await Media.updateOne(
        { _id: media._id, "seasons.number": season },
        {
          $set: {
            "seasons.$[s].episodes.$[e].status": "snatched",
            "seasons.$[s].episodes.$[e].grab": grabInfo,
            lastSearchedAt: new Date(),
          },
        },
        { arrayFilters: [{ "s.number": season }, { "e.status": { $in: ["wanted", "missing", "unaired"] } }] },
      );
    }
  } else {
    // Movie — keep the existing global status flow.
    await Media.updateOne(
      { _id: media._id },
      { $set: { status: "downloading", lastSearchedAt: new Date() } },
    );
  }

  // Outbound notify — Discord + user-configured webhooks
  void emitWebhook(userId, "request.grabbed", {
    type: media.type,
    mediaId: media._id?.toString(),
    tmdbId: media.tmdbId,
    title: media.title,
    year: media.year,
    poster: media.poster,
    episodes: media.type === "tv" && (season != null || episode != null)
      ? [{ season: season ?? null, episode: episode ?? null }]
      : undefined,
    release: {
      title: release.title,
      indexer: release.indexer,
      quality: release.quality,
      sizeBytes: release.sizeBytes,
      seeders: release.seeders,
      infoHash: release.infoHash,
    },
  }).catch(() => {});
}

export async function grabBest(opts: {
  userId: string;
  mediaId: string;
  profileId?: string;
  season?: number;
  episode?: number;
}): Promise<{
  ok: boolean;
  release?: Release;
  error?: string;
  profile?: string;
  profileChain?: string[];
  rejected?: number;
}> {
  await connectMongo();
  const media = await Media.findOne({ _id: opts.mediaId, userId: opts.userId }).lean<any>();
  if (!media) return { ok: false, error: "media not found" };

  await ensureProfilesForUser(opts.userId);
  let profile = await loadProfile(opts.userId, media.type, opts.profileId);
  if (!profile) return { ok: false, error: "no matching profile" };

  const visited = new Set<string>();
  const chain: string[] = [];
  let lastErrors: { indexer: string; message: string }[] = [];
  let lastRejected = 0;

  // Walk the fallback chain until one profile yields ≥1 acceptable release
  // or we run out of fallbacks / hit a cycle (max 5 to be safe).
  while (profile && chain.length < 5 && !visited.has(profile._id.toString())) {
    visited.add(profile._id.toString());
    chain.push(profile.name);

    const { releases, rejected, errors } = await searchAll(
      opts.userId,
      {
        type: media.type,
        // Native-language title matches what trackers index. Fall back to display title.
        title: media.originalTitle || media.title,
        altTitles: [media.title, ...(media.altTitles ?? [])].filter(Boolean) as string[],
        year: media.year,
        yearMin: media.yearMin,
        yearMax: media.yearMax,
        tmdbId: media.tmdbId,
        season: opts.season,
        episode: opts.episode,
      },
      profile,
    );

    if (releases.length > 0) {
      const best = releases[0];
      if (!best.magnet && !best.url) return { ok: false, error: "best release has no download link", profileChain: chain };
      try {
        await pushToQbit(opts.userId, media, best, opts.season, opts.episode);
      } catch (e: any) {
        return { ok: false, error: `qBittorrent: ${e.message}`, profileChain: chain };
      }
      return {
        ok: true,
        release: best,
        profile: profile.name,
        profileChain: chain,
        rejected: rejected.length,
      };
    }

    lastErrors = errors;
    lastRejected = rejected.length;

    if (!profile.fallbackProfileId) break;
    profile = await Profile.findOne({
      _id: profile.fallbackProfileId,
      userId: opts.userId,
    }).lean<any>();
  }

  const sep = lastErrors.length ? lastErrors.map((e) => `${e.indexer}: ${e.message}`).join(" · ") : "";
  const detail = lastRejected ? `; ${lastRejected} filtered out by last profile` : "";
  const errorMsg = `no releases passed any profile — ${sep}${detail}`;
  void emitWebhook(opts.userId, "request.failed", {
    type: media.type,
    mediaId: media._id?.toString(),
    tmdbId: media.tmdbId,
    title: media.title,
    year: media.year,
    poster: media.poster,
    error: errorMsg,
    profileChain: chain,
  }).catch(() => {});
  return {
    ok: false,
    error: errorMsg,
    profile: chain[chain.length - 1],
    profileChain: chain,
    rejected: lastRejected,
  };
}

async function loadProfile(userId: string, mediaType: "movie" | "tv", profileId?: string) {
  if (profileId) {
    const p = await Profile.findOne({ _id: profileId, userId }).lean<any>();
    if (p) return p;
  }
  // user's default for this media type, fallback to global default
  const byType = await Profile.findOne({
    userId,
    isDefault: true,
    appliesTo: { $in: [mediaType, "both"] },
  }).lean<any>();
  if (byType) return byType;
  return Profile.findOne({ userId, isDefault: true }).lean<any>();
}

export async function grabMagnet(opts: {
  userId: string;
  mediaId: string;
  magnet: string;
  /** When grabbing a known release from search results, pass these so the
   *  Download doc has proper metadata and can be correlated with qBit. */
  title?: string;
  infoHash?: string;
  indexer?: string;
  quality?: string;
  sizeBytes?: number;
  seeders?: number;
  season?: number;
  episode?: number;
}): Promise<{ ok: boolean; error?: string }> {
  await connectMongo();
  const media = await Media.findOne({ _id: opts.mediaId, userId: opts.userId }).lean<any>();
  if (!media) return { ok: false, error: "media not found" };

  const link = opts.magnet.trim();
  const isMagnet = link.startsWith("magnet:");
  const isHttp = link.startsWith("http://") || link.startsWith("https://");
  if (!isMagnet && !isHttp) return { ok: false, error: "must be a magnet link or http(s) .torrent URL" };

  const inferredHash = isMagnet ? infoHashFromMagnet(link) : undefined;
  const inferredTitle = isMagnet ? titleFromMagnet(link) : "manual URL";

  try {
    await pushToQbit(
      opts.userId,
      media,
      {
        magnet: isMagnet ? link : undefined,
        url: isHttp ? link : undefined,
        title: opts.title ?? inferredTitle,
        infoHash: opts.infoHash?.toLowerCase() ?? inferredHash,
        indexer: opts.indexer ?? "manual",
        quality: opts.quality,
        sizeBytes: opts.sizeBytes,
        seeders: opts.seeders,
      },
      opts.season,
      opts.episode,
    );
  } catch (e: any) {
    return { ok: false, error: `qBittorrent: ${e.message}` };
  }
  return { ok: true };
}
