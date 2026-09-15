# Feature: UI — Content store, dataset schemas, record grid and editor

**Spec:** Extends §23.2 (feature folders), §23.5 (dynamic form engine), §24.4–§24.7 (layout,
core screens, interaction rules, accessibility).

## Goal

Give *Dev* a place to define dataset schemas (in the Templates store, next to page/section
templates) and give *Elena* a **Content** store: a folder tree, a per-dataset record grid with
server-side paging/sorting/filtering, and a record editor built on the existing generic
`sf-content-form` + `FormBuilderService`. Everything is read-only while time travel is active
(`M15.5` interceptor + disabled controls).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-content-store-and-schema-editor.md](001-content-store-and-schema-editor.md) | `M19.2.1` |
| 2 | [002-record-grid-editor-and-picker.md](002-record-grid-editor-and-picker.md) | 1 |

## Feature exit criteria

- [ ] Nav rail has a Content entry; the Content tree shows folders and records; datasets appear in the
      Templates store.
- [ ] Record grid and record editor work keyboard-only, meet WCAG 2.2 AA, and honor time travel.
- [ ] The asset picker and `reference` editor can pick records (optionally restricted to one dataset).
- [ ] Export picker exposes the Content store and the `datasets` folder.

## Dependencies

`M19.2.1` (API + regenerated types), `M8.1.6` (navigation store UI — layout precedent),
`M13` (templates store folders), `M15.5` (time-travel read-only).
