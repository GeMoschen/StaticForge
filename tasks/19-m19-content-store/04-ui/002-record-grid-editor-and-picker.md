---
id: M19.4.2
status: done
depends: [M19.4.1]
epic: m19-content-store
feature: ui
area: frontend
---

# M19.4.2 — Record grid, record editor, record picking

## Context

The generic form engine — `features/forms/sf-content-form.component.ts` (inputs `definition`,
`formGroup`, `projectKey`) and `form-builder.service.ts` (`buildEditorControl`, `buildRowGroup`,
`valueOf`) — is already used by `pages/page-editor.component.ts` (autosave via
`PageAutosaveService`/`composePagePayload`, `If-Match`, conflict drawer) and
`section-editor.component.ts`. The asset picker is `sf-asset-picker-dialog`; the `reference` editor
restricts by `assetTypes`. `M19.2.1` provides paged/sortable/filterable record listing.

## Goals

- **Record grid** (`features/content/record-grid.component`), per dataset:
  - Columns derived from the dataset's compiled definition: display name + scalar editors
    (`text`, `number`, `date`, `datetime`, `boolean`, `select`, `color`); complex editors hidden by
    default; column chooser persisted per viewer (localStorage, try/catch).
  - Server-side paging, multi-column sort (shift-click), quick search (`q`), advanced filter box
    (`where` expression) showing the 400 diagnostic inline.
  - Row open → record editor; folder filter follows tree selection.
- **Record editor** (`features/content/record-editor.component`): `sf-content-form` bound to the
  dataset's definition; autosave with the same debounce/`If-Match`/conflict-drawer behavior as the page
  editor (extract a shared autosave service if `PageAutosaveService` is page-specific rather than
  duplicating it); validator errors shown per field; revision spine/history for the record; usages
  panel ("used by" pages/templates); read-only in time travel.
- **Picking records:** `sf-asset-picker-dialog` supports `RECORD` (grouped by dataset, searchable via
  the listing endpoint); the `reference` editor passes its `dataset` attribute as a filter; a picked
  record shows display name + dataset badge.

## Acceptance criteria

- [x] Grid with 5,000 records pages/sorts/filters without loading more than one page of rows.
- [x] Editing a record autosaves, creates a revision, and a concurrent edit shows the conflict drawer.
- [x] Invalid content (e.g. required field empty) shows the server validator message on the field.
- [x] Reference editor restricted to `dataset "team"` only offers team records.
- [x] Time travel: grid and editor are read-only; no mutating request leaves the client.
- [x] Keyboard-complete grid (arrow navigation, Enter to open, sort via keyboard) and axe-clean.
- [x] Spec tests for column derivation, sort param serialization and picker filtering.

## Out of scope

- Inline cell editing, bulk edit/delete/move, CSV import/export, saved filters shared between users.

## Notes / hazards

- `where` in the filter box is the OCTL expression grammar (`M19.3.1`), evaluated server-side — do
  not port the evaluator to TypeScript and do not reuse `expression-evaluator.ts` (that is the
  `visibleWhen` grammar).
- Column derivation must tolerate schema changes between page loads (a sorted column disappearing
  after a rename) — fall back to default sort instead of erroring.

## Implementation notes (2026-09-16)

- `sf-record-grid`: server-side paging (50), search, `where` filter with column-accurate errors, header sort
  (Shift for multi-key), column chooser remembered per viewer, ArrowUp/Down + Enter row navigation.
- `sf-record-editor` on `sf-content-form` with per-field server issues (`issues`/`issuePrefix` inputs), Checks /
  History / Usages panels, delete with usage warning, restore, read-only notice in time travel.
- Autosave extracted to `shared/services/autosave.base.ts`; the page editor's autosave now extends it, so records get
  the same debounce, `If-Match` and `409` → `sf-conflict-drawer` flow.
- The asset picker supports RECORD and a `dataset` restriction (no type/dataset switch when restricted); the
  `reference` editor passes `dataset` through.
- Verified live: journeys 2–4 (autosave, filter, keyboard sort, restricted picker → preview, time travel read-only).
  The conflict drawer path is shared code exercised by the page editor journeys, not by a record-specific journey.
