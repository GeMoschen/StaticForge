---
id: M9.1.2
status: todo
depends: [M9.1.1]
epic: m9-project-scoped-uuids
feature: uuid-scope-schema
area: backend
---

# M9.1.2 — Project-scoped repository finder

## Context

`AssetRepository.findByUuid(UUID)` (`server/sf-domain/.../asset/AssetRepository.java`)
is the method every caller currently uses. Once the constraint is per-project
(`M9.1.1`), a bare `findByUuid` can no longer promise a unique result across the whole
server — it needs a project-scoped sibling, and every caller needs to move onto it
(`M9.2`).

## Goals

- Add `Optional<Asset> findByProjectIdAndUuid(long projectId, UUID uuid)` to
  `AssetRepository`.
- Decide, explicitly, what happens to the existing bare `findByUuid(UUID)`:
  either remove it outright (forcing every caller to migrate in `M9.2`, the safer
  choice — a lingering global lookup is an easy accidental reintroduction of the old
  assumption) or keep it only for a documented, deliberately-global use (if `M9.2`'s
  audit finds one — e.g. an ops/admin tool). Default to removing it unless `M9.2`
  surfaces a real need.
- If keeping any global lookup, return type must make the now-possible multiple-match
  case explicit (`List<Asset>`, not `Optional<Asset>`) — a global `Optional` return
  silently picking "whichever row Postgres returns first" across projects would be a
  correctness bug waiting to happen.

## Acceptance criteria

- [ ] `findByProjectIdAndUuid` is covered by a repository test asserting it returns
      the right asset when the same UUID exists in two different projects.
- [ ] The fate of `findByUuid(UUID)` is a deliberate decision recorded in this task's
      notes/implementation record, not silently left in place unchanged.

## Out of scope

- Migrating callers onto the new method (`M9.2.1`).

## Notes / hazards

- Don't migrate callers in this task — keep it scoped to the repository surface so
  `M9.2`'s audit is a clean, reviewable diff of "every call site, one at a time."
