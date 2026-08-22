# Feature: Backend bootstrap

**Spec:** §21.2/21.6 (config), §26.4 (observability), §9.5 (security skeleton).
**Area:** backend. **Epic:** M0.

## Goal

Create the runnable Spring Boot application with correct configuration profiles,
structured logging, Micrometer metrics, Actuator health/info, and a stateless Spring
Security skeleton that returns RFC-9457 problem documents.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-spring-boot-app.md](001-spring-boot-app.md) | M0.1.1 |
| 2 | [002-observability.md](002-observability.md) | 1 |
| 3 | [003-security-skeleton.md](003-security-skeleton.md) | 1 |

## Feature exit criteria

- [ ] `sf-app` boots with profiles `dev`/`test`/`demo`/`prod`, validates schema mode,
      and reports healthy on `/actuator/health`.
- [ ] Structured JSON logs include `traceId`, `projectKey` (when present), `userId`.
- [ ] Unauthenticated `/api/**` requests get a `401` problem document, and a uniform
      `application/problem+json` exception handler is in place.

## Dependencies

`M0:gradle-multiproject` (the modules must exist). Liquibase config is stubbed here and
completed in feature `database-liquibase`.
