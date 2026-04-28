# substitutarr — Plan de remplacement complet du stack *arr

## Contexte
3 audits experts livrés (parité features, file organization, intégration site streaming). Verdict synthèse : substitutarr est ~60% du stack en surface. Le 40% manquant n'est pas cosmétique — c'est le **post-DL pipeline + state reconciliation** qui maintient la cohérence DB ↔ disque.

Source of truth des audits : voir l'historique de la conversation. Synthèse :
- **P0 bloquant prod** : hardlink/foldering post-DL · blocklist · reconciliation disque · catégorie qBit par type
- **P1 site streaming** : endpoints externes manquants · webhook outbound vers le site
- **P1 ops** : notifications · export library · manual import existant
- **Skip** : shim Radarr API v3 (option B), rename TMDB des fichiers, custom formats, calendar view, Bazarr

## Verdict tranché
**GO sur replacement complet** — mais en **double-run avec *arr 1 mois** pendant la transition.

L'option A (migrer le site streaming vers `/api/external/request`) est retenue contre le shim Radarr-compat (option B). Raison : 1 seul client (le site streaming custom), Bazarr ne marcherait pas anyway sans rename pipeline complet. 1j de migration vs 8j de shim mensonger.

## Architecture cible

```
                ┌─────────────────────┐
                │  Site streaming     │  (interface TMDB custom)
                └──────────┬──────────┘
                           │ POST /api/external/request {tmdbId, type}
                           │ Auth: Bearer ars_…
                           ▼
                ┌─────────────────────────────────────┐
                │  substitutarr (Next.js)             │
                │  ├─ search & explain (scoring)      │
                │  ├─ grab orchestration              │
                │  ├─ blocklist + retry guard         │
                │  ├─ disk reconciliation cron        │
                │  └─ outbound webhook (Radarr-compat)│
                └─┬───────────────┬──────────┬────────┘
                  │               │          │
         search   │      push     │     refresh
                  ▼               ▼          ▼
        ┌────────────┐  ┌──────────────┐  ┌──────────┐
        │ Indexers   │  │ qBittorrent  │  │ Jellyfin │
        │ Torznab/   │  │ + post-DL    │  │          │
        │ YTS/EZTV   │  │   hook       │  │          │
        └────────────┘  └──────┬───────┘  └─────▲────┘
                               │ hardlink        │
                               │ + foldering     │
                               ▼                 │
                        ┌─────────────────┐      │
                        │ Library folders │──────┘
                        │ Movies/, TV/    │   scan
                        └─────────────────┘
```

## Roadmap exécutable (~12 jours dev)

### Phase 1 — Combler les P0 (semaine 1)

**J1-J2 — Post-DL hook PowerShell Windows** _(le plus critique, agent spécialiste consulté)_
- qBit "Run external program on torrent finish" → script PowerShell
- Read catégorie (`substitutarr-movies` / `substitutarr-tv`)
- Pour TV : regex `S\d{2}E\d{2}` extrait show+season → `mklink /H` vers `D:\Jellyfin\TV\{Show}\Season {nn}\`
- Pour movies : hardlink vers `D:\Jellyfin\Movies\{release_name}\`
- Skip `*sample*`, `.nfo`, `.txt`
- Pair les `.srt` (subs externes)
- Curl substitutarr `/api/post-process` pour notify Jellyfin refresh
- **Pré-requis** : Downloads et Library sur même volume NTFS

**J3 — Catégorie qBit par type côté substitutarr** (1h)
- Dans `lib/grab.ts pushToQbit()` : `category = media.type === "movie" ? "substitutarr-movies" : "substitutarr-tv"` (override le user setting)

**J4 — Blocklist + retry guard** (1j)
- New model `BlockedRelease { userId, infoHash, releaseTitle, reason, blockedAt, expiresAt }`
- Pre-grab check dans `grabBest`/`grabMagnet` → skip blocked
- Auto-blocklist sur grab fail répété (3 fois) avec TTL 24h
- UI : ligne "Blocked" dans la modale Search & explain
- Endpoint `POST /api/library/[id]/blocklist` pour bloquer manuellement

**J5 — Disk reconciliation cron** (0.5j)
- Hook `/api/post-process` reçu après hook PowerShell → update `episode.file.path` + `status: "downloaded"`
- Nightly cron passe sur tous les `downloaded` → vérifie via Jellyfin (item lookup) → si absent → `missing`
- Activity log "deleted_externally" event

### Phase 2 — Connecter le site streaming (semaine 2)

**J6 — Endpoints externes manquants** (0.5j)
- `GET /api/external/requests` (liste paginée des items en library + status)
- `GET /api/external/requests/:id` (détail + status courant)
- `DELETE /api/external/requests/:id` (annule + supprime)
- `GET /api/external/profiles` (liste des profils visibles)
- `GET /api/external/lookup?tmdbId=X&type=movie` (vérifie déjà en lib)

**J7 — Outbound webhook system** (1j)
- New model `OutboundWebhook { userId, url, secret, events[], active, lastDeliveryAt, failureCount }`
- Worker fire-and-forget (queue Mongo simple) avec HMAC SHA-256, exponential backoff, 5 retries, dead letter
- Events : `request.grabbed`, `request.completed`, `request.failed`
- Format payload Radarr-compat (`OnGrab`/`OnDownload`) pour future Overseerr-compat
- UI Settings → Webhooks (CRUD)

**J8 — Notification provider Discord** (0.5j)
- Hardcode Discord webhook format (simple URL POST)
- Settings → Notifications field (URL)
- Émet sur `request.completed` et `request.failed`

**J9 — Manual import existing library** (1j)
- Endpoint `POST /api/import/scan { rootPath, type }`
- Server-side : scan dir → regex parse `(Title)[. ]?(Year)` ou `Show/Season N/SxxExx` → match TMDB → populate DB en `downloaded` avec `file.path`
- UI Settings → Manual import wizard

**J10 — Library export JSON** (0.5j)
- `GET /api/export/library` → JSON `{ movies: [{tmdbId, monitored, profileId, addedAt}], series: [{tmdbId, seasons: [{number, monitored, episodes: [{number, status}]}]}] }`
- Plan B anti-lock-in

### Phase 3 — Migration prod (semaine 2 fin)

**J11 — Shadow mode** (0.5j)
- Site streaming continue d'appeler Radarr en prod
- Ajout d'un fetch parallèle vers substitutarr (best-effort, log seulement, errors silencieuses)
- Compare les comportements 24-48h

**J12 — Cutover pilote** (0.5j)
- Toi seul bascule sur substitutarr
- Radarr/Sonarr en read-only (firewall l'API write)
- 1 semaine de test en conditions réelles

**J13 — Cutover full** (si pilote OK)
- Tout le monde sur substitutarr
- Radarr/Sonarr en background read-only encore 1 mois (rollback)

**J14 — Decom *arr** (après 1 mois sans incident)
- Stop Radarr/Sonarr/Prowlarr
- Garde dump SQL Radarr 6 mois

## Pré-requis bloquants à valider AVANT toute exécution
1. **Downloads et Library Jellyfin sur même volume NTFS** ? (sinon hardlinks fail)
2. qBit "Run external program on torrent finish" accessible (settings BitTorrent advanced)
3. Site streaming code source accessible pour la migration J6-J11

## Skipped (et c'est ok)
- ❌ Shim Radarr API v3 (1 seul client custom, pas Overseerr/Jellyseerr/Bazarr)
- ❌ Rename TMDB des fichiers (release names suffisent pour Jellyfin movie matching)
- ❌ Custom Formats (notre scoring système est différent et marche)
- ❌ Bazarr equivalent (laisse Bazarr tourner en parallèle si subs voulues)
- ❌ Quality cutoff auto-upgrade (manual re-grab au cas par cas)
- ❌ Calendar view (un cron + Discord ping sur new TV episode suffit)

## État d'avancement (mis à jour au fil de l'eau)

### Avant ce plan ✅
- [x] Search & explain avec scoring multi-dim
- [x] 5 profils auto-seedés + chaîne fallback
- [x] TV episode-level state machine + monitoring strategies
- [x] qBit v5+ client robuste (race-safe, hardcoded category)
- [x] Multi-user Clerk
- [x] API externe `POST /api/external/request` avec Bearer
- [x] Cron sweep distributed lock + reconcile downloads
- [x] Connection health auto-recorded
- [x] Detail pages TV + Movie (hero, cast, similar, activity, collection)
- [x] Dedicated season page (filter + thumbnails)
- [x] /downloads sectioned (Active/Queued/Completed/Failed)
- [x] i18n EN default + FR
- [x] Read me + LICENSE pushed
- [x] Privacy : git author rewrite to PhytoPlancton

### Phase 1 — P0 prod-ready
- [x] Post-DL hook PowerShell (J1-J2) — `scripts/post-dl.ps1` + HMAC handler at `/api/post-process`
- [x] qBit category per type (J3) — `lib/grab.ts` types `substitutarr-{movies,tv}`
- [x] Blocklist + retry guard (J4) — `BlockedRelease` model, `lib/blocklist.ts`, auto-strike on qBit fail, `POST /api/library/[id]/blocklist`, `GET /api/blocklist`
- [x] Disk reconciliation (J5) — `/api/cron/reconcile-disk` re-flags missing TV episodes nightly

### Phase 2 — Site streaming
- [x] Endpoints externes manquants (J6) — `GET /api/external/{requests,requests/[id],profiles,lookup}`, `DELETE /api/external/requests/[id]`
- [x] Outbound webhook system (J7) — `OutboundWebhook` + `WebhookDelivery` models, HMAC SHA-256, exponential backoff, dead letter, Radarr/Sonarr-compat option, `/api/webhooks` CRUD + test, `/api/cron/webhooks/process` queue worker, emit hooks in `grabBest`/`pushToQbit`/post-process
- [x] Discord notifications (J8) — `lib/discord.ts` + UserSettings.notifications.discordWebhook + per-event filter
- [x] Manual import (J9) — `POST /api/import/scan` (dry-run + apply), regex SxxExx + Radarr-style `Title (YYYY)` parser, TMDB best-match
- [x] Library export (J10) — `GET /api/export/library` schema-versioned JSON dump for migration / lock-in protection

### Phase 3 — Migration (à faire après J1-J10)
- [ ] Shadow mode (J11)
- [ ] Pilote (J12)
- [ ] Cutover full (J13)
- [ ] Decom *arr (J14)
