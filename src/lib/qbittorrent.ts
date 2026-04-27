type QbConfig = { url: string; user: string; password: string };

export class QBittorrent {
  private cookie: string | null = null;
  private cookieAt = 0;
  /** SID cookies expire after ~1h of inactivity; we proactively re-login at 50min. */
  private static readonly COOKIE_TTL_MS = 50 * 60_000;
  constructor(private cfg: QbConfig) {}

  private base(path: string) {
    return `${this.cfg.url.replace(/\/$/, "")}${path}`;
  }

  private cookieFresh(): boolean {
    return !!this.cookie && Date.now() - this.cookieAt < QBittorrent.COOKIE_TTL_MS;
  }

  private async login() {
    const body = new URLSearchParams({ username: this.cfg.user, password: this.cfg.password });
    const res = await fetch(this.base("/api/v2/auth/login"), {
      method: "POST",
      body,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: this.cfg.url,
      },
    });
    if (!res.ok) throw new Error(`qBit login ${res.status}`);
    const text = (await res.text()).trim();
    if (text === "Fails.") throw new Error("qBit login failed — wrong username/password");
    const cookie = res.headers.get("set-cookie") || "";
    const sid = cookie.match(/SID=([^;]+)/)?.[1];
    if (sid) {
      this.cookie = `SID=${sid}`;
    } else {
      // qBit with IP-bypass-auth returns Ok. without setting a cookie. Treat as
      // authed but mark cookieAt so cookieFresh() works.
      this.cookie = this.cookie ?? "";
    }
    this.cookieAt = Date.now();
  }

  private async req(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    if (!this.cookieFresh()) await this.login();
    const headers: HeadersInit = { ...(init.headers || {}), Referer: this.cfg.url };
    if (this.cookie) (headers as Record<string, string>).Cookie = this.cookie;
    const res = await fetch(this.base(path), { ...init, headers });
    if (res.status === 403 && retry) {
      this.cookie = null;
      this.cookieAt = 0;
      return this.req(path, init, false);
    }
    return res;
  }

  /** Health check — fast, no side effects. */
  async ping(): Promise<{ version: string }> {
    const res = await this.req("/api/v2/app/version");
    if (!res.ok) throw new Error(`qBit ping ${res.status}`);
    return { version: (await res.text()).trim() };
  }

  /**
   * Add a torrent. Accepts either a magnet link or any URL pointing to a .torrent
   * file (qBit fetches it itself — perfect for Torznab `enclosure.url` with apikey).
   *
   * Polls /info up to 5s after add to confirm the torrent landed (qBit add is
   * async, the hash may not appear for 1-2s).
   */
  async add(
    urlOrMagnet: string,
    opts: { category?: string; savePath?: string; expectedHash?: string; cookie?: string } = {},
  ) {
    const body = new URLSearchParams();
    body.set("urls", urlOrMagnet);
    if (opts.category) body.set("category", opts.category);
    if (opts.savePath) body.set("savepath", opts.savePath);
    if (opts.cookie) body.set("cookie", opts.cookie);
    body.set("autoTMM", "false");
    const res = await this.req("/api/v2/torrents/add", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error(`qBit add ${res.status}: ${await res.text()}`);
    const text = (await res.text()).trim();
    if (text === "Fails.") throw new Error("qBit refused the torrent (invalid URL or magnet)");

    // Race: qBit ack'd the add but the hash may not be visible yet.
    if (opts.expectedHash) {
      const hash = opts.expectedHash.toLowerCase();
      for (const wait of [200, 500, 1000, 2000, 3000]) {
        await new Promise((r) => setTimeout(r, wait));
        const list = await this.list({ hashes: [hash] });
        if (list.some((t) => t.hash.toLowerCase() === hash)) return true;
      }
      // Don't throw — qBit might just be slow on the announce. Caller can decide.
    }
    return true;
  }

  /** Re-check then start a stuck torrent (used to recover from disk-full errors). */
  async recheck(hashes: string[]) {
    const body = new URLSearchParams({ hashes: hashes.map((h) => h.toLowerCase()).join("|") });
    await this.req("/api/v2/torrents/recheck", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  /** Force start, bypassing the queue (queuedDL stuck for too long). */
  async forceStart(hashes: string[]) {
    const body = new URLSearchParams({
      hashes: hashes.map((h) => h.toLowerCase()).join("|"),
      value: "true",
    });
    await this.req("/api/v2/torrents/setForceStart", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  /** Move a torrent to a new save path (used to fix wrong path post-add). */
  async setLocation(hashes: string[], location: string) {
    const body = new URLSearchParams({
      hashes: hashes.map((h) => h.toLowerCase()).join("|"),
      location,
    });
    await this.req("/api/v2/torrents/setLocation", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  /** @deprecated use add() */
  async addMagnet(magnet: string, opts: { category?: string; savePath?: string } = {}) {
    return this.add(magnet, opts);
  }

  async list(opts: { category?: string; hashes?: string[] } = {}) {
    const params = new URLSearchParams();
    if (opts.category) params.set("category", opts.category);
    if (opts.hashes?.length) params.set("hashes", opts.hashes.map((h) => h.toLowerCase()).join("|"));
    const res = await this.req(`/api/v2/torrents/info?${params}`);
    if (!res.ok) throw new Error(`qBit list ${res.status}`);
    const arr = (await res.json()) as Array<{
      hash: string;
      name: string;
      progress: number;
      state: string;
      size: number;
      dlspeed: number;
      eta: number;
      content_path: string;
      save_path: string;
    }>;
    // Normalize hash to lowercase (qBit already does, but be defensive)
    return arr.map((t) => ({ ...t, hash: t.hash.toLowerCase() }));
  }

  async delete(hashes: string[], deleteFiles = false) {
    const body = new URLSearchParams({
      hashes: hashes.map((h) => h.toLowerCase()).join("|"),
      deleteFiles: String(deleteFiles),
    });
    const res = await this.req("/api/v2/torrents/delete", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!res.ok) throw new Error(`qBit delete ${res.status}`);
  }

  async pause(hashes: string[]) {
    const body = new URLSearchParams({ hashes: hashes.map((h) => h.toLowerCase()).join("|") });
    // qBit ≥5.0 renamed pause→stop. Try stop first, fall back to pause on 404.
    let res = await this.req("/api/v2/torrents/stop", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (res.status === 404) {
      await this.req("/api/v2/torrents/pause", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    }
  }

  async resume(hashes: string[]) {
    const body = new URLSearchParams({ hashes: hashes.map((h) => h.toLowerCase()).join("|") });
    // qBit ≥5.0 uses /torrents/start; older versions use /torrents/resume.
    // Try start first, fall back to resume on 404.
    let res = await this.req("/api/v2/torrents/start", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (res.status === 404) {
      res = await this.req("/api/v2/torrents/resume", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
    }
  }
}

export async function getUserQbit(userId: string): Promise<QBittorrent> {
  const { connectMongo } = await import("./mongo");
  const { UserSettings } = await import("@/models/UserSettings");
  await connectMongo();
  const s = await UserSettings.findOne({ userId }).lean<any>();
  const cfg: QbConfig = {
    url: s?.qbittorrent?.url || process.env.QBIT_URL!,
    user: s?.qbittorrent?.user || process.env.QBIT_USER!,
    password: s?.qbittorrent?.password || process.env.QBIT_PASSWORD!,
  };
  if (!cfg.url) throw new Error("qBittorrent not configured");
  return new QBittorrent(cfg);
}
