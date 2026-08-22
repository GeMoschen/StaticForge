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
| `SF_OUTPUT_ROOT`    | backend  | Generated output root (mounted volume in compose)             |
