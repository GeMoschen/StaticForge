---
id: M3.4.3
status: done
depends: [M3.4.2]
epic: m3-editing-ui
feature: pages
area: frontend
---

# M3.4.3 — Autosave & conflict handling

## Context

Implement §23.5 autosave and the §24.6 conflict conversation.

## Goals

- Dirty state debounced 1.5 s, flushed on blur/section switch/`Ctrl/Cmd+S`; each flush =
  one revision with auto-comment ("Edited Headline in Teaser").
- `Saved 12:04` indicator with a revision link in the header.
- On `409` show a drawer comparing both versions field-by-field with "keep mine / take
  theirs" and who/changed-what/when (§24.6) — no silent overwrite (§7.5).

## Acceptance criteria

- [ ] Autosave covers the §23.5 triggers; no save on pure focus loss.
- [ ] `409` opens the conflict drawer with per-field resolution, never a lost-update.

## Out of scope

- Merge *diff rendering* polish (M6 conflicts) — a functional field-level merge is enough.

## Notes / hazards

- Reuse the `409` problem payload (`expectedRevision`/`currentRevision`).
