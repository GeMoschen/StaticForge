# M0 — Skeleton

**Spec:** §4 (architecture), §21 (backend impl), §22 (DB/Hibernate/Liquibase), §23
(frontend). Roadmap M0 (§27): 2 weeks.

## Goal

Stand up the empty but running system: Gradle multi-module backend, Spring Boot app
bootstrapping, Liquibase-schema foundation, H2 test harness, Angular shell, CI, and a
local `docker compose` environment. No product features yet — just a green skeleton on
which every later epic builds.

## Exit criteria (epic is done when)

- [x] `docker compose up` starts PostgreSQL, the backend (healthy), and the SPA
      behind nginx.
- [x] Backend builds and `./gradlew build` passes with unit/slice tests against H2.
- [x] Liquibase runs on startup and `ddl-auto: validate` succeeds (no drift).
- [x] Angular app boots, shows a placeholder shell, and the typed API client
      generation pipeline works on a smoke contract.
- [x] CI pipeline is green on push (build + test + lint).

## Features

| # | Feature | Area | Notes |
|---|---|---|---|
| 1 | [gradle-multiproject](01-gradle-multiproject/README.md) | infra/backend | Replaces the placeholder single-module build |
| 2 | [backend-bootstrap](02-backend-bootstrap/README.md) | backend | Spring Boot app + security skeleton + logging/metrics |
| 3 | [database-liquibase](03-database-liquibase/README.md) | backend | Liquibase changelogs + Hibernate + H2 harness |
| 4 | [frontend-shell](04-frontend-shell/README.md) | frontend | Angular workspace + tokens + client generation |
| 5 | [docker-compose](05-docker-compose/README.md) | infra | Local run environment + runbook |

## Dependencies

None (this is the first epic). All later epics depend on M0.

## Note on the existing repo

The current `build.gradle.kts` / `settings.gradle.kts` / `src/main/java/de/gemo/Main.java`
are a placeholder. Feature `01-gradle-multiproject` replaces them with the real
multi-module layout described in [`../project-structure.md`](../project-structure.md).
