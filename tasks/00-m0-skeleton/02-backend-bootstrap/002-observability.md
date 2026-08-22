---
id: M0.2.2
status: done
depends: [M0.2.1]
epic: m0-skeleton
feature: backend-bootstrap
area: backend
---

# M0.2.2 — Observability foundation

## Context

Set up the logging, metrics, and health infrastructure described in §26.4 so that later
epics emit consistent telemetry for free.

## Goals

- Configure structured JSON logging (Logback) with MDC fields `traceId`, `projectKey`,
  `revision`, `userId`.
- Wire Micrometer metrics registry and expose `/actuator/metrics` (secured later);
  define the metric-name conventions in §26.4 (`sf.revision.allocate`,
  `sf.render.duration`, `sf.generation.*`, `sf.media.upload.bytes`, cache hit ratios).
- Configure `/actuator/health` to include DB, blob store, and Liquibase checks, and
  `/actuator/info` to expose the schema version.
- Add OpenTelemetry tracing scaffolding (request → service) so span context is available.

## Acceptance criteria

- [ ] `/actuator/health` reports `UP` with component detail (DB, Liquibase).
- [ ] A request produces a JSON log line carrying `traceId`.
- [ ] Metric registrations follow §26.4 naming; no duplicate meters.

## Out of scope

- Alerting rules (M7).
- Securing actuator to non-admin roles is addressed later but health must remain
  reachable for liveness probes.

## Notes / hazards

- Avoid log pollution: don't log secrets; mask password/token fields (§26.3).
