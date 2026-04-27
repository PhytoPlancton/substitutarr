# Edge cases — punch list triée

Synthèse des audits par 3 agents experts (métadonnées/TV-anime/intégrations+sécurité). Cas déjà fixés en 🟢.

## P0 — Ces bugs vont te frapper en usage réel cette semaine

### Métadonnées
1. **Titres avec `:` ne matchent pas chez les indexers** — "Avatar: The Way of Water" → 0 résultat sur c411 qui indexe `Avatar.The.Way.of.Water`. Fix : générer variantes (`full`, `before_colon`, `after_colon`, `colon→space`, `colon→dash`) et merger les résultats.
2. **Apostrophes courbes vs droites** — TMDB renvoie `L'Émission` (U+2019), uploaders tapent `L.Emission` ou `LEmission`. Fix : normalisation NFKD + strip accents/apostrophes des deux côtés avant comparaison.
3. 🟢 Diacritiques (`é`, `î`) — déjà géré par TMDB en fr-FR, mais matching côté substitutarr non normalisé. Étendre le strip de diacritiques au scoring.
4. **Année dans le titre piège** — "Blade Runner 2049" (2017) parse `2049` comme année. Fix : retirer le titre TMDB de la chaîne avant year-extraction.
5. **Tolérance year ±1** — sortie FR souvent 1-3 mois après US, année différente sur c411. Fix : appel `/movie/{id}/release_dates`, accepter fenêtre `[min, max+1]`.

### qBittorrent
6. **SID cookie expire après ~1h d'inactivité** → 403 silencieux. Fix : déjà retry once en place, mais ajouter healthcheck proactif + invalidation cache si le retry échoue 2 fois de suite.
7. **Hash uppercase vs lowercase** — qBit normalise lowercase, certains indexers renvoient uppercase. Fix : `hash.toLowerCase()` systématique avant store et avant `info?hashes=`.
8. **Race add → info (~1-2s)** — torrent ajouté mais pas encore visible dans `info`. Fix : poll backoff `[200, 500, 1000, 2000, 5000]`ms avant de marquer "orphan".

### Sécurité (multi-user / external API)
9. **SSRF via Torznab URL custom** — user malicieux ajoute indexer `http://169.254.169.254/latest/meta-data/` (AWS metadata) → leak. Fix : valider URL, refuser RFC1918/loopback/link-local. Suivre redirects manuellement et re-valider chaque hop.
10. **API keys en URL Torznab leaked en logs** — `?apikey=<secret>` apparaît dans les `console.log`. Fix : redact des params `apikey`/`api_key` dans tout logger.
11. **Cross-user leak par filtre `userId` oublié** — j'ai 10+ routes API, une seule sans `userId` dans le `findOne` = leak. Fix : wrapper `scopedModel(Model, userId)` ou plugin Mongoose global.
12. **Cron sans lock** — si un sweep prend > 10min, le suivant démarre en parallèle → double grab. Fix : lock distribué dans Mongo (`CronLock` collection avec TTL).

## P1 — À faire avant prod ou avant TV-shows

### TV / séries (zéro support actuel)
13. **Season packs vs épisodes** — releases `Show.S01.COMPLETE.1080p` vs `Show.S01E01`. Currently substitutarr n'a aucune notion de pack. Fix : detector de pack + stratégie ("manque ≥ 50% saison ET pack dispo → pack").
14. **Multi-épisodes en un fichier** — `S01E01-E02` regex naïve attrape juste E01. Fix : étendre `/S(\d{2})E(\d{2})(?:[-.]?E?(\d{2}))?/`.
15. **tvsearch params Torznab** — `t=tvsearch&season=N&ep=M` ; fallback `tvdbid` puis `imdbid` puis query texte. C411 ne supporte pas tvsearch correctement → query texte FR avec `S01E05`.
16. **PROPER/REPACK upgrade** — episode déjà DL, PROPER sort 2j après, substitutarr ignore. Fix : detect proper + auto-regrab si meilleur score.

### Sécurité / ops
17. **Rate-limit `/api/external/request`** — clé volée = hammer illimité. Fix : Mongo TTL counter ou Upstash Redis, 60 req/min par keyId.
18. **API keys expirent jamais + pas de scopes** — clé volée valable indéfiniment. Fix : `expiresAt` (default +90j), `scopes: ['external:request']`.
19. **isDefault race** — `updateMany + findOneAndUpdate` non atomique. Fix : index partial unique sur `{userId}` filtré `isDefault: true` → impossible structurellement d'avoir 2 défauts.
20. **Health endpoint manquant** — `GET /api/health` qui ping Mongo + qBit + Jellyfin.
21. **Cookie tracker pour trackers privés** — torrent ajouté reste `stalledDL` 0 peers si tracker requiert cookie session. Fix : exposer field `cookie` par catégorie d'indexer.

## P2 — Plus tard (pas urgent en MVP)

22. Anime numérotation absolue (One Piece S20E10 ↔ E1085) — requiert TVDB ou AniList mapping
23. Daily shows par date (`The Daily Show 2026.04.24`) — bypass tvsearch, query texte avec date
24. Faux positifs sur titres courts (Heat, Up, 9) — scoring composite Jaro-Winkler + runtime ±10min
25. Group lock par saison TV (éviter mix NTb + FLUX dans S01)
26. Clerk webhook `user.deleted` → cascade soft-delete des Media/Profiles/Downloads
27. Pepper sur hash API key (HMAC-SHA256 avec secret env)
28. Logging structuré (pino + redact paths)
29. Path mapping config user-defined (Docker volumes Linux ↔ Windows)
30. Mid-season splits (Stranger Things S04 Vol.1 / Vol.2)
31. Anime VOSTFR vs MULTI vs DUAL (forced subs vs full subs)
32. CSP / HSTS / X-Frame-Options dans `next.config.js`
33. Cache TMDB (Mongo TTL 24h) pour éviter rate-limit 40 req/sec
34. Soft-delete profiles pour pas casser un grab en cours
35. Reconciliation cron qui détecte les torrents supprimés dans qBit UI
36. Anime saisonnier "Cour" mapping
37. Multi-version Jellyfin (4K + 1080p mêmes film)
38. Webhook plugin Jellyfin pour event `Item Added`
