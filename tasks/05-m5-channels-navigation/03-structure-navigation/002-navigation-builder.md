---
id: M5.3.2
status: done
depends: [M5.3.1]
epic: m5-channels-navigation
feature: structure-navigation
area: backend
---

# M5.3.2 — Navigation computation

## Context

Implement the §17.2 algorithm.

## Goals

- Implement `NavigationBuilder`: resolve root → collect subtree from the generation
  snapshot, apply include/exclude predicates, sort, cut at depth, mark active/trail
  relative to the rendered page.
- Memoize per `(structureUuid, channel, activePageUuid)` within a build.
- Cycle protection: track visited UUIDs; a cycle yields `SF-GEN-0410` and truncates.

## Acceptance criteria

- [ ] The §17.2 steps execute in order and mark active/trail correctly.
- [ ] A cyclic folder structure is truncated with `SF-GEN-0410`, not a stack overflow.

## Out of scope

- Nav rendering (next task).

## Notes / hazards

- Use the revision-pinned snapshot index for reproducible navs.
