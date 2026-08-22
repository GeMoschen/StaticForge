---
id: M3.4.2
status: done
depends: [M3.3.3]
epic: m3-editing-ui
feature: pages
area: frontend
---

# M3.4.2 — Page editor, sections & body editing

## Context

Implement the split-view page editor of §23.6.

## Goals

- Three-pane layout: page tree | page fields + bodies/sections | preview.
- Page fields rendered by the form engine from the page template's CDL.
- Body/section editing: add section via filtered `+ Section` palette (allowed templates
  + thumbnails + category), collapsible section cards (collapse state persisted per
  user/template), reorder via CDK drag-drop **and** `Alt+↑/↓`.
- Section add/remove/order calls the §20.2 page body endpoints.

## Acceptance criteria

- [ ] Reordering works by drag and keyboard; drag is never the only way (§23.6).
- [ ] `+ Section` picker only lists templates allowed by the body's `allow` list.
- [ ] Preview pane is present (iframe wiring completes in feature 6).

## Out of scope

- Autosave (next task); preview mechanics (feature 6).

## Notes / hazards

- Persist collapse state per user per template (§23.6).
