# substitutarr — Plan

## Objectif
Remplacer Prowlarr + Sonarr + Radarr par un seul site, plus efficient. Aucune dépendance sur les *arr — tout est rebuilt from scratch.

## Stack
- **Next.js 15.3** (App Router, React 19) — déployé via le tuto EDJ Labs
- **MongoDB** + Mongoose — collections : `media`, `indexers`, `downloads`, `usersettings`
- **Clerk** — auth multi-user
- **TMDB** — métadonnées films/séries
- **Indexer adapters** custom : YTS, EZTV, Torznab générique (pas Jackett, pas Prowlarr)
- **qBittorrent Web API** — ton PC à `82.66.229.27:8080`
- **Jellyfin API** — refresh auto après import
- **Cron** : `/api/cron?key=...` à appeler toutes les 10 min

## Architecture
```
┌────────────────────────────────────────────┐
│  Next.js (UI + API routes)                 │
│  ├─ /search        TMDB search             │
│  ├─ /library       monitored items         │
│  ├─ /downloads     live qBit state         │
│  ├─ /settings      indexers + integrations │
│  └─ /api/cron      reconcile + grab loop   │
└────────────┬───────────────────────────────┘
             │
   ┌─────────┼──────────┬───────────┐
   ▼         ▼          ▼           ▼
 MongoDB  Indexers   qBittorrent  Jellyfin
          (YTS,
           EZTV,
           Torznab)
```

## Multi-user
- Chaque user a sa propre Library, ses propres Indexers, ses propres Settings.
- qBittorrent et Jellyfin sont configurables par user (URL + creds).
- Chaque Download est lié à un userId.

## État actuel — MVP livré ✅

### Fait
- [x] Skeleton Next.js 15.3 + Tailwind + TanStack Query
- [x] Clerk middleware + sign-in/sign-up
- [x] MongoDB connection mutualisée + 4 modèles Mongoose
- [x] TMDB search + getDetails (films + séries avec saisons/épisodes)
- [x] Indexer system : `Indexer` interface + `YtsIndexer`, `EztvIndexer`, `TorznabIndexer`
- [x] Quality parsing + scoring (préfère 1080p, pénalise CAM/TS, bonus REMUX/seeders)
- [x] Registry indexers : `searchAll()` query parallèle + dédup par infoHash
- [x] qBittorrent client (cookie auth + add/list/delete/pause/resume)
- [x] Jellyfin client (refresh all / refresh by lib name)
- [x] `grabBest()` orchestration : search → pick best → push to qBit → enregistre Download
- [x] API routes : `/api/tmdb/search`, `/api/library`, `/api/library/[id]`, `/api/indexers`, `/api/indexers/[id]`, `/api/indexers/search`, `/api/grab`, `/api/downloads`, `/api/downloads/[id]`, `/api/settings`, `/api/cron`
- [x] UI : Dashboard / Search / Library / Downloads / Settings (avec section Indexers inline)
- [x] Cron route protégée par `CRON_SECRET` : reconcile + auto-grab
- [x] Dockerfile (standalone Next output, multi-stage)
- [x] GitHub Actions workflow `.github/workflows/build.yml` (push tags → GHCR)
- [x] `.env.example` avec tous les env vars
- [x] `npm run build` passe ✅

### À faire (post-MVP, dans l'ordre)
- [ ] **Setup local Mongo Atlas + Clerk dev** (créer une app Clerk, copier les keys)
- [ ] Créer le repo GitHub `PhytoPlancton/substitutarr`, push, tag `v0.1.0`
- [ ] DNS `substitutarr.nmt.ovh` sur Cloudflare → 79.137.79.153
- [ ] Stack EDJ Labs avec les 10 Deploy Labels
- [ ] Cron externe (cron-job.org ou GitHub Action) qui ping `/api/cron?key=...` toutes les 10 min
- [ ] Tester end-to-end : ajouter un film → grab → fichier dans qBit → refresh Jellyfin
- [ ] **Renaming/import** : déplacer les fichiers depuis `/downloads` vers `/movies/Title (year)/` une fois complets
- [ ] **Slack notifications** sur fin de download
- [ ] Calendar view des sorties (TV)
- [ ] Quality profiles fines (multi-tier preferred + fallback)

## Déploiement EDJ Labs (résumé du tuto)
1. `git tag v0.1.0 && git push --tags`
2. GitHub Actions build l'image → `ghcr.io/phytoplancton/substitutarr:latest`
3. Stack EDJ Labs : image, env vars (voir `.env.example`), Deploy Labels (les 10 standards), network `traefik-public`
4. Update stack → site live sur `substitutarr.nmt.ovh`

## Comment ça marche en prod
- Tu vas sur `substitutarr.nmt.ovh`, login Clerk
- Onglet **Settings** : tu colles ton qBittorrent URL+creds, ton Jellyfin URL+API key, tu ajoutes au moins 1 indexer (YTS pour films, EZTV pour TV)
- Onglet **Search** : tu cherches "Dune", tu cliques `+`
- L'item apparaît dans **Library** en `wanted`
- Le cron toutes les 10 min lance `grabBest()` → trouve la meilleure release → push à qBit
- qBit télécharge → cron suivant détecte completion → status passe à `downloaded` → Jellyfin refresh
