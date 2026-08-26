---
id: M10.3.3
status: todo
depends: [M10.3.1]
epic: m10-selective-export-import
feature: export-import-ui
area: frontend
---

# M10.3.3 — Import panel with conflict review

## Context

The other half of the tab: upload → analyze → show conflicts → let the user cancel or
proceed. This is the piece the user's request calls out explicitly ("before importing:
show conflicts ... and add ability to cancel the import here"), so the cancel path
needs to be obviously present and safe, not a buried option.

## Goals

- `project-settings-import.component.ts` (same standalone/`OnPush`/signals structure as
  `M10.3.2`).
- File picker (drag-and-drop + click-to-browse) accepting `.zip` only.
- On file selection, automatically call `analyzeImport` and show a loading state
  ("Checking archive…") — no separate "Analyze" button needed unless the analyze call
  is slow enough that an explicit trigger reads better (use judgment; a spinner over
  the drop zone is probably enough).
- Conflict report rendering:
  - Grouped into two sections, "Blocking issues" and "Warnings", each with a count
    badge; blocking section shown first and, when non-empty, visually distinct (e.g.
    error-toned) from warnings.
  - Each `ImportConflict` renders its `elementLabel` and `detail` in one line, with an
    icon/tag for its `ConflictType` (reuse whatever icon/badge component the existing
    settings tabs already use — check `project-settings-url-registry.component` and
    `channels`/`generation` components for the established pattern before inventing a
    new one).
  - Zero conflicts at all: a clear "No conflicts found" success state, not just an
    empty list.
- Two actions once analysis completes: **Cancel** (clears the picked file and report,
  zero server calls beyond the analyze that already ran) and **Import** (disabled
  while any `BLOCKING` conflict is present, calls `commitImport` on click, shows a
  result summary — `ImportResultView`'s counts — on success).
- Handle the 409-on-commit case from `M10.3.1` (conflicts changed between analyze and
  commit — e.g. someone else imported in the meantime): show a message telling the
  user to re-analyze, don't silently retry.

## Acceptance criteria

- [ ] Uploading an archive with a blocking conflict disables the Import button and
      shows the blocking section first.
- [ ] Uploading a clean archive (no conflicts) shows the success state and an enabled
      Import button.
- [ ] Clicking Cancel after analysis clears the file/report and returns the panel to
      its initial empty state, with no additional network calls.
- [ ] Clicking Import after a successful commit shows the import result counts and
      returns the panel toward its initial state (ready for another import), not stuck
      on a stale report.
- [ ] A 409 on commit renders a distinct "conflicts changed, please re-check" message
      rather than the generic error state.

## Out of scope

- Per-conflict resolution controls (skip this one item, override that key) — this
  epic's UI is report-then-accept-or-cancel only, per the epic's exit criteria.
- Export panel (`M10.3.2`).

## Notes / hazards

- This is the "professional UI/UX" bar the user asked for explicitly — treat the
  empty/loading/success/blocking/warning states as first-class, not afterthoughts.
  Look at how `project-settings-url-registry.component` handles its own loading/empty/
  error states as the baseline quality to match.
