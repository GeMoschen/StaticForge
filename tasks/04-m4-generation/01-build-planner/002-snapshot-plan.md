---
id: M4.1.2
status: done
depends: [M4.1.1, M2.2.3]
epic: m4-generation
feature: build-planner
area: backend
---

# M4.1.2 — Snapshot & plan (full/incremental)

## Context

Implement §18.2 stages 1–2: pin the revision, load an immutable index, compute the file
set.

## Goals

- Implement the **snapshot**: pin revision R, load an immutable in-memory index of all
  assets at R (§18.2).
- Implement the **planner**: full = every page × every enabled channel; incremental =
  changed assets since last successful run, expanded over `asset_reference` reverse edges
  (transitive; navigation-affecting changes expand to all pages rendering that structure).
- Output a dependency-ordered file-set plan.

## Acceptance criteria

- [ ] Full plan = all pages × channels; incremental plan = transitive reference closure.
- [ ] A media change only rebuilds pages referencing it (not the whole site).

## Out of scope

- Validation/render stages (later features).

## Notes / hazards

- The snapshot index must be deterministic for reproducible republishing (§18.1).
