---
id: M3.2.2
status: done
depends: [M3.2.1]
epic: m3-editing-ui
feature: project-context
area: frontend
---

# M3.2.2 — Project context store & resolvers

## Context

Implement §23.4's `projectContextStore` and project route resolvers.

## Goals

- Implement `projectContextStore`: active project, channels, folder tree, template
  catalogue, loaded once per entry, refreshed on revision change.
- Expose `currentRevision()` so any view shows "you are looking at revision 1842".
- Implement `project.resolver.ts` loading context before project routes render.

## Acceptance criteria

- [ ] Context loads once per project and refreshes on revision change (SSE/known trigger).
- [ ] `currentRevision()` is reactive and consumed by headers/editors.

## Out of scope

- Revision spine (M6) — the store just exposes the value.

## Notes / hazards

- Use signals (zoneless); avoid eager global fetching.
