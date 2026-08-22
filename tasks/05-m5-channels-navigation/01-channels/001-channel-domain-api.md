---
id: M5.1.1
status: done
depends: [M1.1.1]
epic: m5-channels-navigation
feature: channels
area: backend
---

# M5.1.1 — Output channel domain & API

## Context

Implement the §15.2 model and §15.3 CRUD.

## Goals

- Implement `OutputChannel` (key `[a-z][a-z0-9_]{1,39}` unique/project, name,
  file_extension, mime_type, default_escaping, enabled, is_default, position, settings
  JSON) + Liquibase changeset.
- Create `html` with every project (non-deletable, only disable); enable/disable endpoint;
  delete blocked while channel templates exist (response lists them).
- `POST /channels` makes the new channel appear in every template's OCTL editor; add
  `Copy from channel` seeding (§15.4).

## Acceptance criteria

- [ ] `html` is default + non-deletable; other channels full CRUD.
- [ ] Deleting a used channel is blocked and lists the N templates.
- [ ] `default_escaping` value drives renderer escaping (already wired to renderer).

## Out of scope

- Channel UI (next task).

## Notes / hazards

- Deleting channel + templates is a separate explicit two-step (§15.3).
