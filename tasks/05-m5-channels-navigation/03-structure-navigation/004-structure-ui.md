---
id: M5.3.4
status: done
depends: [M5.3.3, M3.2.2]
epic: m5-channels-navigation
feature: structure-navigation
area: frontend
---

# M5.3.4 — Structure & navigation UI

## Context

Implement the Structures screen (§24.5 #7).

## Goals

- Source definition editor (grammar) + per-channel renderer editor (OCTL).
- Live tree preview with a page selector to test `active`/`trail`.
- List structures (navigation/breadcrumb/list) with CRUD.

## Acceptance criteria

- [ ] Editing a source updates the live tree preview.
- [ ] A page selector demonstrates active/trail marking live.

## Out of scope

- Monaco language for the source grammar (reuse OCTL/CDL languages where possible).

## Notes / hazards

- Preview uses the same computation path, pinned to current revision.
