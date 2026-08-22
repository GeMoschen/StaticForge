# Feature: Docker compose & local environment

**Spec:** §26.6 (operations), §4.1/4.2 (Postgres external Docker container).
**Area:** infra. **Epic:** M0.

## Goal

Provide a reproducible local environment: `docker compose` brings up PostgreSQL, the
backend, and the SPA behind nginx, with correct startup ordering and a developer runbook.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-docker-compose.md](001-docker-compose.md) | M0.2.1, M0.4.1 |
| 2 | [002-local-runbook.md](002-local-runbook.md) | 1 |

## Feature exit criteria

- [ ] `docker compose up` yields a healthy backend (Liquibase applied) + Postgres + the
      SPA served by nginx.
- [ ] A failed Liquibase migration keeps the container unhealthy (§26.6).
- [ ] A developer can run the full stack locally in one command, documented.

## Dependencies

`M0:backend-bootstrap`, `M0:frontend-shell` (both must produce buildable artifacts).
