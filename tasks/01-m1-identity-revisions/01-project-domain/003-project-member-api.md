---
id: M1.1.3
status: done
depends: [M1.1.2]
epic: m1-identity-revisions
feature: project-domain
area: backend
---

# M1.1.3 — Project & membership REST API

## Context

Expose the Projects + members endpoints from §20.2 with DTOs, mappers, pagination, and
idempotency per §20.1 conventions.

## Goals

- Implement controllers/DTOs for `GET/POST /projects`, `GET/PUT /projects/{key}`,
  `POST /projects/{key}/archive`, `GET /projects/{key}/members`,
  `PUT/DELETE /projects/{key}/members/{userId}`.
- Return only projects the caller is a member of on `GET /projects`.
- Honour `Idempotency-Key` on `POST` creates (24 h), pagination envelope, and
  `application/problem+json` errors.
- Wire OpenAPI metadata (title/descriptions) so the client generation (M0.4.4) picks
  these up.

## Acceptance criteria

- [ ] Each endpoint is correctly role-gated and returns RFC-9457 errors on failure.
- [ ] `POST /projects` creates revision 1 (once the revision service exists) and only
      `INSTANCE_ADMIN` may call it.
- [ ] `GET /projects` returns only the caller's projects.

## Out of scope

- Revision internals — the create-project hook will begin allocating once `revision`
  feature is available.

## Notes / hazards

- Controllers hold no business logic (§21.2): validate → service → map.
