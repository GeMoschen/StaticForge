# M1 — Identity & Revisions

**Spec:** §5 (domain model), §6 (identity/UUID/UID), §7 (revision safety), §8
(projects/users/permissions), §9 (JWT auth), §10 (Page), §20 (REST API). Roadmap M1
(§27): 3 weeks.

## Goal

Implement the durable core of the system: projects, users, membership + role-based
authorization, JWT authentication, asset identity (UUID/UID), revision safety
(counter + version intervals + optimistic concurrency), generic asset CRUD (folder,
page), diff/restore, and the property-based invariants that prove it correct.

## Exit criteria (epic is done when)

- [x] Property-based revision invariants (§25.5) pass: gapless revisions, exactly one
      valid version per revision, reproducible reads, correct restore, no lost updates.
- [x] Login → create project → create folder → create page works end-to-end over the
      REST API.
- [x] JWT access+refresh flow, role enforcement, and 404-vs-403 project-hiding work.
- [x] `If-Match`/ETag optimistic concurrency returns `409` with a merge problem document.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [project-domain](01-project-domain/README.md) | backend | — |
| 2 | [auth](02-auth/README.md) | backend | 1 |
| 3 | [asset-identity](03-asset-identity/README.md) | backend | 1 |
| 4 | [revision](04-revision/README.md) | backend | 3 |
| 5 | [asset-api](05-asset-api/README.md) | backend | 3, 4 |
| 6 | [diff-restore](06-diff-restore/README.md) | backend | 4, 5 |
| 7 | [revision-invariants](07-revision-invariants/README.md) | qa/backend | 4, 5 |

## Dependencies

`M0-skeleton` (modules, schema harness, security skeleton, H2 harness must exist).
