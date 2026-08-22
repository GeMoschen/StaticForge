---
id: M0.5.1
status: done
depends: [M0.2.1, M0.4.1]
epic: m0-skeleton
feature: docker-compose
area: infra
---

# M0.5.1 — Docker compose environment

## Context

Local/production-packaging runs as two containers + external PostgreSQL (§26.6). Create
the compose file and the supporting Dockerfiles.

## Goals

- Add `infra/docker/docker-compose.yml` defining `db` (PostgreSQL 16), `backend`
  (the `sf-app` bootJar image), and `web` (nginx serving `staticforge-ui` + proxying
  `/api` to the backend).
- Add Dockerfiles for backend (multi-stage Gradle build → JRE 21 image) and the SPA
  (build → nginx).
- Configure backend healthcheck so Liquibase must succeed before `healthy` (§26.6);
  set `depends_on` with health conditions for correct startup order.
- Mount volumes for Postgres data and the (future) media/output roots; wire env vars
  for `DB_*` and secrets.

## Acceptance criteria

- [ ] `docker compose up` starts all three services; backend reports `healthy`.
- [ ] A deliberately failing migration keeps the backend `unhealthy`, not a degraded
      start.
- [ ] The SPA is reachable and proxies `/api` to the backend.

## Out of scope

- Blob/out volumes' external configuration details (M4/M3 media).
- Production TLS termination (documented in ops runbook later).

## Notes / hazards

- Don't hardcode secrets in the compose file; use `.env` / environment injection.
