---
id: M3.4.1
status: done
depends: [M3.2.2]
epic: m3-editing-ui
feature: pages
area: frontend
---

# M3.4.1 — Page list & folder tree

## Context

Implement the Pages screen (§24.5 #3).

## Goals

- Folder tree with virtual scroll, drag-move and keyboard move; tree from the context
  store's folder catalogue.
- Centre table: display name, UID, template, updated, updated-by, status per channel.
- Multi-select for bulk move/delete; `?folder/templateUuid/q` filtering.
- Page detail route resolving the full payload + resolved template definition.

## Acceptance criteria

- [ ] Tree and table are virtual-scrolled (perf, §23.8).
- [ ] Bulk move/delete works; move confirms when > 100 assets.

## Out of scope

- Time-travel/read-only mode (M6).

## Notes / hazards

- Keep `trackBy` everywhere; OnPush.
