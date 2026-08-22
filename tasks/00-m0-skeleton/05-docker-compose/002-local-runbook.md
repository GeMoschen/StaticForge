---
id: M0.5.2
status: done
depends: [M0.5.1]
epic: m0-skeleton
feature: docker-compose
area: infra
---

# M0.5.2 — Local development runbook

## Context

Give developers a single, repeatable way to start and work with the stack (§26.6 profiles
`dev`/`test`/`demo`/`prod`).

## Goals

- Write `docs/` or `infra/` runbook: prerequisites, `docker compose up`, DB access,
  seeding a `demo` project, running backend tests, running frontend dev server.
- Document profile selection (`dev` vs `demo`), HS256 dev-security note (§9.3), and the
  media/output root locations.
- Add `infra/scripts/` helpers where useful (e.g. `dev-up`, `docs-serve`).

## Acceptance criteria

- [ ] A fresh contributor can follow the runbook and reach a running app with a seeded
      demo project without hand-holding.
- [ ] `demo` context data (Liquibase `demo` context) loads when the demo profile is used.

## Out of scope

- Production deployment playbook (M7).

## Notes / hazards

- Keep runbook next to the compose file so it stays in sync.
