# StaticForge — Local Development Runbook

A single, repeatable way to run and develop the StaticForge stack locally.

## Prerequisites

- **JDK 21** (Temurin) — the backend targets Java 21.
- **Node.js 20+** (LTS) and npm — the Angular frontend toolchain.
- **Docker** with the Compose plugin (`docker compose`) — for the Postgres/backend/nginx stack.

Verify with:

```sh
java -version        # expect 21.x
node -v              # expect v20.x or newer
docker compose version
```

## Quick start (full stack)

```sh
cd infra/docker
cp .env.example .env     # then edit DB_PASSWORD
docker compose up --build
```

This starts three services:

| Service  | Purpose                                            | Port(s)          |
|----------|----------------------------------------------------|------------------|
| `db`     | PostgreSQL 16 (external Docker container)          | internal only    |
| `backend`| Spring Boot app; runs Liquibase on startup         | 8080 (internal)  |
| `web`    | nginx serving the SPA, proxying `/api` to backend | `${WEB_PORT:-8080}` |

Wait until `backend` reports `healthy` (the health probe only turns UP after Liquibase
migrations succeed — a failed migration keeps it *unhealthy* rather than starting a
degraded app, per spec §26.6). Then open **http://localhost:8080** (or your `WEB_PORT`).

Stop with `docker compose down` (add `-v` to also drop the Postgres data volume).

## Database connection

- **Host/port:** `localhost:5432` when reaching the `db` service directly (add a `ports`
  mapping to `docker-compose.yml` if needed) or `db:5432` from within the compose network.
- **Database:** `staticforge` (`DB_NAME`)
- **User/password:** from your `.env` (`DB_USER` / `DB_PASSWORD`).

The schema is owned by Liquibase; nothing is created manually. The `prod` profile runs the
`prod` Liquibase context.

## Running the backend locally (no Docker)

The backend runs standalone against in-memory H2 under the `dev` profile:

```sh
./gradlew :server:sf-app:bootRun
```

`dev` uses H2 in PostgreSQL compatibility mode and **HS256** signing with a bundled
dev-only secret (spec §9.3 — never use HS256 in `prod`). The app listens on port 8080;
health is at `http://localhost:8080/actuator/health`.

## Running the frontend dev server

```sh
cd ui
npm ci
npm start
```

This boots the Angular dev server (default `http://localhost:4200`) with hot reload. Point
it at a running backend via the environment proxy config (e.g. `ng serve --proxy-config
proxy.conf.json`, if present).

## Profiles

The backend has four Spring profiles (spec §26.6):

| Profile | Database | Signing | Liquibase contexts |
|---------|----------|---------|--------------------|
| `dev`   | H2 in-memory | HS256 (dev-only) | default |
| `test`  | H2 in-memory | HS256 (dev-only) | default |
| `demo`  | H2 in-memory | HS256 (dev-only) | `demo` (seeds sample data) |
| `prod`  | PostgreSQL    | **RS256** (keystore) | `prod` |

Select a profile with `SPRING_PROFILES_ACTIVE` or `--spring.profiles.active=`.

## Running the tests

Backend (compiles all modules, runs unit + slice tests, `spotlessCheck`, and the
`checkModuleLayers` graph guard):

```sh
./gradlew build
```

Frontend:

```sh
cd ui
npm test
```

## Environment variables

| Variable            | Used by  | Description                                                    |
|---------------------|----------|----------------------------------------------------------------|
| `DB_NAME`           | db, backend | Database name (default `staticforge`)                        |
| `DB_USER`           | db, backend | Database role (default `staticforge`)                        |
| `DB_PASSWORD`       | db, backend | Database password (required)                                 |
| `SPRING_PROFILES_ACTIVE` | backend | Profile (`prod` in compose)                               |
| `SF_JWT_SECRET`     | backend  | HS256 secret (dev/demo only)                                  |
| `SF_JWT_KEYSTORE`   | backend  | RS256 keystore location (prod; provisioned in M1)             |
| `SF_MEDIA_ROOT`     | backend  | Media blob store root (mounted volume in compose)             |
| `SF_SEARCH_INDEX_ROOT` | backend | Root of the embedded search indexes, one directory per project (`search-index` volume in compose; default `./build/search-index`). Derived data: safe to delete, rebuilt on start. **One backend instance per index root** — see [Search: single-instance constraint](#search-single-instance-constraint) |
| `SF_OUTPUT_ROOT`    | backend  | Generated output root; each target publishes to `{projectKey}/{path}/current` beneath it. Old shared-root output (`builds/`, `current`, `s3/`) is deleted at startup unless `sf.generate.cleanup-legacy-output=false` — repoint web servers first |

## Search: single-instance constraint

Editorial search (M23) keeps an embedded Apache Lucene index per project on the backend's disk
(`SF_SEARCH_INDEX_ROOT`, the `search-index` volume). Lucene allows **one writer per index directory**, guarded by a
`write.lock` file, so **one backend instance** may use an index root. This is a scaling limit of v1, next to the
single-node generation queue.

- **Why:** the index is updated after every commit by the instance that made the commit; a second instance would
  neither receive those updates nor be allowed to write the same directory.
- **Symptoms of a second instance on the same volume:** its log shows `Search index of project N is locked by another
  process. Search supports a single application instance per index root`, `GET /search` answers `503 SF-SEARCH-0503`,
  `GET /search/status` reports `UNAVAILABLE`, and `/actuator/health` stays `UP` with the detail `search: DEGRADED`.
  Everything else keeps working.
- **What multi-instance would need:** per-node index volumes (each instance catches up from the revision log with its
  own revision stamp, and a load balancer would have to route a user's searches to a caught-up node), or a shared index
  service. Neither is implemented.
- **No backup needed:** the index is derived from the database. Exclude it from backups (see the backup runbook).
- **Forcing a rebuild:** a project admin calls `POST /api/v1/projects/{key}/search/reindex` (or uses **Rebuild index**
  on the search page); queries keep answering from the old index until the new one is swapped in. To rebuild
  everything, stop the backend, delete the `search-index` volume (or the directory) and start it again. An index from
  another database (e.g. after restoring a dump) is detected and rebuilt automatically.
- `sf.search.live-indexing=false` (`SF_SEARCH_LIVE_INDEXING` in the dev profile) stops indexing after each commit; the
  index then only catches up on start or reindex. Useful to demonstrate a lagging index, not for production.

