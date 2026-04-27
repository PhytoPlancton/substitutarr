# Lessons — substitutarr

Format : `[date] | ce qui a mal tourné | règle à suivre`

---

**[2026-04-25]** | `middleware.ts` à la racine au lieu de `src/middleware.ts` → toutes les API routes Clerk renvoyaient 500 (`clerkMiddleware() was not run`). Symptôme côté UI : impossible d'ajouter/sauver quoi que ce soit. | **Quand le projet a un dossier `src/`, le middleware DOIT être dans `src/middleware.ts` — Next.js ne le détecte pas à la racine.** Pareil pour tout fichier de config special-cased par Next (instrumentation.ts, error.tsx racine, etc).

**[2026-04-25]** | Mongoose plante sur Atlas avec `tlsv1 alert internal error: SSL alert number 80` malgré DNS+SRV OK. | **Atlas envoie un TLS alert internal_error quand l'IP source n'est pas whitelistée** — c'est un faux positif "TLS error" alors que la vraie cause est Network Access. Toujours commencer par check Atlas → Network Access avant de soupçonner Node/OpenSSL. Pour dev perso : `0.0.0.0/0` ; pour prod : ajouter l'IP fixe d'EDJ Labs.

**[2026-04-25]** | Quand Clerk n'est pas configuré (CLERK_SECRET_KEY manquante/placeholder), l'app rentre en boucle de redirect vers /sign-in et toutes les pages plantent. | Toujours rendre l'auth **opt-in** : helper `clerkConfigured()` + `getUserId()` qui retourne un user fallback en dev. Middleware no-op et `<ClerkProvider>` conditionnel. Permet à un nouvel arrivant de cloner le repo et `npm run dev` sans config Clerk.

**[2026-04-26]** | qBittorrent répond toujours HTTP 200 sur `/api/v2/auth/login` même quand l'auth échoue — il met juste `Fails.` dans le body au lieu de `Ok.`. Sans check du body, le client suit aveuglément et plante 30s plus tard sur un 403 mystérieux. | **Toujours lire le body string de qBit après login et add** : `Ok.` vs `Fails.`. Pareil sur `/torrents/add` qui peut renvoyer 200 + `Fails.` si l'URL/magnet est invalide.

**[2026-04-26]** | Adapter Torznab avec URL bare-host (`https://c411.org`) construisait `https://c411.org?t=search...` et hit la racine du site → 503 Cloudflare. Le bon endpoint était `/api/torznab`. | Adapter Torznab : auto-append `/api/torznab` si l'URL utilisateur ne contient pas déjà `/api` ou `/torznab`. Aussi : ajouter un User-Agent réaliste, AbortSignal timeout 25s, retry une fois sur 521/522/524 (origin Cloudflare flaky).

**[2026-04-26]** | Mon adapter Torznab utilisait `<link>` qui pointe vers la page web, pas vers le `.torrent`. Résultat : qBit ne pouvait rien télécharger. | **Le download URL Torznab est dans `<enclosure url="..." type="application/x-bittorrent">`, pas dans `<link>`** (qui est la page comments). Toujours préférer `enclosure.url` sauf s'il pointe lui aussi vers la page (rare cas où le tracker fait n'importe quoi).

**[2026-04-26]** | Les sites torrents derrière Cloudflare rate-limit agressif sur les endpoints search lourds (caps reste OK). Tests en boucle pendant le dev font monter 503/521/timeout pendant 5-15min. | Dev workflow : ne pas hammerer un indexer pendant le debug. Prévoir un mode mock/cache pour tester l'adapter sans hit réel. Cron en prod doit espacer les requêtes (10 min minimum entre searches sur le même indexer).

**[2026-04-26]** | qBit `/torrents/add` accepte le param `urls` aussi bien pour magnet:// que pour http(s):// pointant vers un .torrent. Plus simple que d'uploader le .torrent en multipart. | Pour les private trackers Torznab, passer `enclosure.url` (qui contient l'apikey) directement à qBit `urls=`. qBit fera lui-même le téléchargement du .torrent côté serveur. Ça évite à substitutarr de jouer le proxy.

**[2026-04-27]** | grab.ts envoyait `savepath=/downloads/movies` (Linux) à un qBit Windows → torrent en state=error, 0% progress, jamais débloqué. | **Ne JAMAIS envoyer un savepath custom si l'utilisateur ne l'a pas explicitement configuré** : laisser qBit utiliser sa default. Schema des paths : default `""`, pas un chemin présomptueux. Pour fix un torrent déjà coincé : `POST /api/v2/torrents/setLocation` puis `/torrents/start`.

**[2026-04-27]** | `/api/v2/torrents/resume` renvoie 404 sur qBit ≥ 5.0. | Sur qBit récent, l'endpoint a été renommé en `/torrents/start` (et `pause` → `stop`). Pour rester compatible, essayer `/start` d'abord, fallback sur `/resume` si 404.
