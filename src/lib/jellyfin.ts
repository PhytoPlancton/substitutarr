type JfConfig = { url: string; apiKey: string };

export class Jellyfin {
  constructor(private cfg: JfConfig) {}

  private base(path: string) {
    return `${this.cfg.url.replace(/\/$/, "")}${path}`;
  }

  private headers(): HeadersInit {
    return {
      "X-Emby-Token": this.cfg.apiKey,
      "Content-Type": "application/json",
    };
  }

  /** Trigger a full library scan. */
  async refreshAll(): Promise<void> {
    const res = await fetch(this.base("/Library/Refresh"), {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`Jellyfin refresh ${res.status}`);
    }
  }

  /** Refresh a specific library by name (e.g. "Movies", "TV Shows"). */
  async refreshLibrary(name: string): Promise<void> {
    const libsRes = await fetch(this.base("/Library/VirtualFolders"), { headers: this.headers() });
    if (!libsRes.ok) return this.refreshAll();
    const libs: any[] = await libsRes.json();
    const lib = libs.find((l) => l.Name?.toLowerCase() === name.toLowerCase());
    if (!lib) return this.refreshAll();
    const res = await fetch(this.base(`/Items/${lib.ItemId}/Refresh?Recursive=true`), {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok && res.status !== 204) throw new Error(`Jellyfin refresh ${res.status}`);
  }

  /** Resolve a Jellyfin userId — retention uses the first non-disabled user. */
  async getDefaultUserId(): Promise<string | null> {
    try {
      const res = await fetch(this.base("/Users"), { headers: this.headers() });
      if (!res.ok) return null;
      const users: any[] = await res.json();
      const u = users.find((u) => !u.Policy?.IsDisabled) ?? users[0];
      return u?.Id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch playback metadata for the whole library at once. Filtered by provider
   * (TMDB) so we can pivot the result by tmdbId. Cheap: ~1 round-trip even with
   * 1000+ items.
   */
  async getUserDataByTmdbId(userId: string): Promise<
    Map<
      number,
      {
        played: boolean;
        playCount: number;
        lastPlayedDate?: string;
        isFavorite: boolean;
        type: "Movie" | "Series" | "Episode";
      }
    >
  > {
    const params = new URLSearchParams({
      Recursive: "true",
      IncludeItemTypes: "Movie,Series,Episode",
      Fields: "ProviderIds,UserData",
      EnableUserData: "true",
    });
    const res = await fetch(this.base(`/Users/${userId}/Items?${params}`), {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Jellyfin user items ${res.status}`);
    const data = (await res.json()) as { Items?: any[] };
    const out = new Map<number, any>();
    for (const it of data.Items ?? []) {
      const tmdb = it.ProviderIds?.Tmdb ?? it.ProviderIds?.tmdb;
      const tmdbId = tmdb ? Number(tmdb) : NaN;
      if (!tmdbId || Number.isNaN(tmdbId)) continue;
      const ud = it.UserData ?? {};
      // Aggregate at the series level for episodes: keep the most-recently played per tmdbId
      const prev = out.get(tmdbId);
      const entry = {
        played: !!ud.Played,
        playCount: ud.PlayCount ?? 0,
        lastPlayedDate: ud.LastPlayedDate ?? undefined,
        isFavorite: !!ud.IsFavorite,
        type: it.Type as "Movie" | "Series" | "Episode",
      };
      if (!prev) {
        out.set(tmdbId, entry);
      } else {
        // Prefer most-recent LastPlayedDate, max PlayCount, OR favorite override
        const cmp = (a?: string, b?: string) => (a && b ? new Date(a).getTime() - new Date(b).getTime() : a ? 1 : -1);
        out.set(tmdbId, {
          played: prev.played || entry.played,
          playCount: Math.max(prev.playCount, entry.playCount),
          lastPlayedDate:
            cmp(entry.lastPlayedDate, prev.lastPlayedDate) > 0 ? entry.lastPlayedDate : prev.lastPlayedDate,
          isFavorite: prev.isFavorite || entry.isFavorite,
          type: prev.type === "Series" ? prev.type : entry.type,
        });
      }
    }
    return out;
  }
}

export async function getUserJellyfin(userId: string): Promise<Jellyfin | null> {
  const { connectMongo } = await import("./mongo");
  const { UserSettings } = await import("@/models/UserSettings");
  await connectMongo();
  const s = await UserSettings.findOne({ userId }).lean<any>();
  const cfg: JfConfig = {
    url: s?.jellyfin?.url || process.env.JELLYFIN_URL || "",
    apiKey: s?.jellyfin?.apiKey || process.env.JELLYFIN_API_KEY || "",
  };
  if (!cfg.url || !cfg.apiKey) return null;
  return new Jellyfin(cfg);
}
