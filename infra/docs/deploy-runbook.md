# StaticForge — Deploy runbook

Zero-downtime deployment and migration procedure for §26.6. The deployment unit is two containers — the Spring Boot backend and the static SPA behind nginx — plus an external PostgreSQL 16 container (see `infra/docker/docker-compose.yml`).

## Topology

| Service | Image / role | Notes |
|---|---|---|
| `db` | `postgres:16` | external Postgres; schema owned by Liquibase |
| `backend` | `server/sf-app/Dockerfile` | runs Liquibase at startup; healthy only after migrations succeed |
| `web` | `ui/Dockerfile` (nginx) | serves the SPA, proxies `/api/` to `backend` (`infra/nginx/default.conf`) |

`infra/nginx/default.conf` proxies `/api/` to `backend:8080` and falls back non-file routes to `/index.html` for client-side routing.

## Environment

Configuration is via environment variables (`SPRING_PROFILES_ACTIVE`, `DB_*`, `SF_MEDIA_ROOT`, `SF_OUTPUT_ROOT`, `SF_SEARCH_INDEX_ROOT`, `SF_JWT_KEYSTORE` for RS256). See the env table in `infra/README.md`. Secrets come from `.env` (never committed); JWT keys come from a mounted keystore in `prod`.

## Zero-downtime deploy

The app is stateless apart from the blob store and the search index, so rolling deploys need no sticky sessions (JWT in header; spec §26.2). SSE generation progress connections need connection affinity or Redis pub/sub only in the multi-node profile.

**Search index: one instance per volume (M23).** The embedded Lucene index (`search-index` volume) can be written by one
backend at a time. During a rolling deploy the new backend can't open a project's index while the old one still holds
it: that project's search answers `503 SF-SEARCH-0503` on the new backend until restart. Stop the old backend before
starting the new one on the same volume (a few seconds of downtime), or give the new backend an empty index volume —
it rebuilds every project's index in the background at start (about 2 s per 5,000 pages, see
`infra/scripts/README-benchmark.md`) while search answers from whatever is indexed so far. Symptoms, what multi-instance
would need, and how to force a rebuild: `infra/README.md` → "Search: single-instance constraint".

### Standard release (no destructive schema change)

1. **Migrate first.** Deploy/start the new backend; Liquibase applies backward-compatible changesets before the container becomes healthy. A failed migration keeps the container **unhealthy** rather than starting a degraded app (compose healthcheck + §26.6).
2. **Roll new backend** behind the load balancer; drain old instances after the new one reports `UP` on `/actuator/health`.
3. **Ship the SPA** container (`web`). The nginx config is forward-compatible; no API shape change is assumed.

### Destructive schema change — expand → migrate → contract

For changes that drop columns/tables or alter types destructively (§26.6), run across two releases:

1. **Expand (release N):** ship additive changesets only — new columns/tables, no destructive edits. Both old and new code paths remain valid. Liquibase changesets are immutable once merged (spec §22.4), so destructive intent is *expressed* by adding new state and deprecating old.
2. **Migrate (between releases):** run the backfill/migration step; verify data parity.
3. **Contract (release N+1):** now that the old shape is unused, ship the removal changeset in a follow-up release — never in the same deploy as the code that still reads the removed columns.

## Rollback

- **Backend:** the last N builds are retained for generation rollback (`POST /generations/{runId}/promote`, §18.4); for a code rollback, redeploy the prior image and `docker compose` restarts the prior backend. Because the schema is Liquibase-managed and additive changesets are forward-compatible, an old backend can run against a schema that is one expand ahead.
- **SPA:** redeploy the prior `web` image; nothing stateful is in the SPA.

## Health & verification

- Startup order is enforced by compose healthchecks: `db` (`pg_isready`) → `backend` (`/actuator/health`, which includes DB, blob store, and Liquibase checks per §26.4) → `web`.
- Post-deploy smoke test: `GET /api/v1/status`, `GET /actuator/health`, login, open one page, and start a preview render.
- Search: `/actuator/health` shows `search: AVAILABLE` (not `DEGRADED`), and `GET /api/v1/projects/{key}/search/status`
  reaches `READY` shortly after start (`CATCHING_UP`/`REBUILDING` while the startup catch-up runs).

## Rollout checklist

- [ ] `.env` secrets present; RS256 keystore mounted in `prod`.
- [ ] Liquibase status clean against a restored production dump (CI drift check, §22.4).
- [ ] New backend healthy on `/actuator/health` before draining old instances.
- [ ] Only one backend uses the `search-index` volume (old backend stopped first, or the new one has its own volume).
- [ ] For destructive changesets: expand shipped and migrated **before** contract ships.
- [ ] Smoke test passed; generation progress (SSE) verified if the multi-node profile is in use.
