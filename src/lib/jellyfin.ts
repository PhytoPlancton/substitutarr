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
