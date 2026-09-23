# Feature: UI — record sets in the Content store, set query editor, record templates, pickers

**Spec:** Extends §23 (Angular features), §24 (editor UX, time travel read-only).

## Goal

Editors organise records in record sets and define each set's query with live feedback; developers write
per-channel record templates next to the dataset schema; reference editors, search, routing and the
export picker understand `RECORD_SET`.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-content-store-record-sets.md](001-content-store-record-sets.md) | `M25.3.1` |
| 2 | [002-dataset-record-template-editor.md](002-dataset-record-template-editor.md) | `M25.3.1` |
| 3 | [003-reference-picker-search-routing.md](003-reference-picker-search-routing.md) | `M25.3.1` |

## Feature exit criteria

- [ ] Sets are first-class in the Content tree; records are created and moved only within sets.
- [ ] Set query editor with validation and live match count.
- [ ] Dataset editor has per-channel record template tabs with diagnostics.
- [ ] Reference editors pick sets; search and deep links route to sets.
- [ ] `npm run build` and `npx vitest run` green.

## Dependencies

`M25.3.1` (API + regenerated `schema.d.ts`), `M19.4.*` (Content store UI — `features/content`), `M23.2`
(search palette), `M24.4` (locale switcher — the record grid/editor keep it).
