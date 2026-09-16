# Feature: Pagination editor component + preview page selector

**Spec:** Extends §23.5 (dynamic form engine), §23.6 (page editor layout), §19.3 (in-app preview
affordances), §24.7 (accessibility).

## Goal

Give content editors a form control for the `PAGINATION` value (source picker, page size, sort),
registered in the dynamic form engine like every other editor type. Paginated pages also get a
page selector in the preview pane, so an editor can check page 2..N before publishing.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-pagination-editor-and-preview.md](001-pagination-editor-and-preview.md) | `M21.1.1`, `M21.3.1` |

## Feature exit criteria

- [x] A `pagination` editor renders in `sf-content-form` via `EDITOR_REGISTRY`, is keyboard-complete,
      and round-trips the stored value through autosave.
- [x] The preview pane shows "Page n of N" with prev/next controls for paginated pages and nothing
      for others.
- [x] Both are read-only in time travel (`TimeTravelStore.isTimeTravel`, readonly interceptor).
- [x] The visual diff (`features/revisions/visual-diff/resolve-editor.ts`) shows a readable summary of
      a `PAGINATION` value change.

## Dependencies

`M21.1.1` (editor type + value shape in the compiled definition), `M21.3.1` (preview `?page` +
`X-SF-Total-Pages`), `M19.4.2` (dataset picker; dataset branch only).
