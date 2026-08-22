---
id: M5.1.2
status: done
depends: [M5.1.1, M3.2.2]
epic: m5-channels-navigation
feature: channels
area: frontend
---

# M5.1.2 — Channel management UI

## Context

Implement the Channels screen (§24.5 #8).

## Goals

- Small table + form for channel CRUD; deleting shows the exact list of templates that
  lose a channel body (§24.5).
- Enable/disable toggles; `html` shows as protected.
- "Copy from channel" action in the template IDE scope (consumed by markdown feature).

## Acceptance criteria

- [ ] CRUD + enable/disable work; delete previews affected templates.
- [ ] `html` is visually non-deletable.

## Out of scope

- Markdown-specific copy flow (feature 2).

## Notes / hazards

- Keep the delete confirmation proportional (§24.6).
