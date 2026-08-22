---
id: M6.2.2
status: done
depends: [M6.2.1, M1.6.2]
epic: m6-revision-ux
feature: history
area: frontend
---

# M6.2.2 — Diff viewer & restore UI

## Context

Implement the side-by-side diff and restore/rollback affordances (§7.6, §24.5 #9).

## Goals

- Side-by-side diff viewer consuming `GET /revisions/{r}/diff` (field paths; richtext
  block-level).
- Restore one asset (`/assets/{uuid}/restore`) and project-wide rollback (`/restore`)
  with typed confirmation (§24.6).
- Clear "a new revision was created" feedback.

## Acceptance criteria

- [x] Diff renders field-by-field; richtext diffs at block level.
- [x] Asset restore and project rollback create new revisions and show a link.

## Out of scope

- Merge (conflict feature).

## Notes / hazards

- Restore never rewrites history — reflect that in copy.

## Backend status (M6.2.2)

`JsonDiffer` now diffs rich-text fields at block level: a
`{"format":"html","value":"…"}` value is split into blocks (`HtmlBlockSplitter`) and diffed
via LCS, emitting one `FieldChange` with `blocks` (`BlockChange{index,kind,before,after}`)
for `ADD`/`REMOVE`/`UPDATE` instead of one opaque whole-array change. Non-richtext fields
keep structural equality. Covered by `JsonDifferTest`. Frontend diff viewer/restore UI still
open — `status` left `todo`.
