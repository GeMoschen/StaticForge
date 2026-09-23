---
id: M25.5.1
status: todo
depends: [M25.3.1]
epic: m25-record-sets
feature: ui
area: frontend
---

# M25.5.1 — Record sets in the Content store (tree, CRUD, set-scoped grid, query editor)

## Context

`ui/src/app/features/content` (`M19.4.*`): `content.component` (folder tree + per-dataset record grid),
`record-grid.component` / `record-grid.util` (server-side paging, sorting, filtering), `record-editor`
(`sf-content-form`, `record-autosave.service`), `content.service`. Record creation goes through
`shared/components/sf-create-asset-dialog.component` (`CreateAssetKind`). Time travel makes every editor
read-only.

## Goals

- **Tree:** Content folders show record sets as leaf nodes (distinct icon, record count badge, a warning
  badge when `queryValid` is false). Context menu: new record set (in folders), rename, move (folders
  only as targets), delete with a cascade confirmation showing the record count, change uid, usages,
  history.
- **Create set dialog:** display name, uid (auto-derived), dataset (required, pick from live datasets —
  immutable afterwards, the dialog says so).
- **Set view** (route `content/sets/:uuid`): header with name, dataset, record count; a collapsible
  **Set query** panel — `where` (monospace input), sort keys (field picker + asc/desc, reorderable),
  `limit`, `offset` — validated via `POST …/preview-query` (debounced) with inline diagnostics and a
  live "N of M records match"; Save / Revert, `If-Match` conflict handling like other editors.
- **Grid:** the `M19` record grid scoped to the set (`GET /record-sets/{uuid}/records`). Toggle
  "Show as rendered" (`applySetQuery=true`: set query applied, rows in render order, excluded records
  hidden) vs. "All records" (default; rows excluded by the set query are visibly dimmed with a
  tooltip). The user's own grid filter/sort stays ephemeral and never edits the set query; an action
  "Use current filter as set query" copies it into the panel (unsaved).
- **Records:** "New record" only exists inside a set (dataset implied — drop the dataset choice from the
  record create dialog); moving a record offers only sets of the same dataset; the record editor
  breadcrumb shows folder › set › record.
- Time travel: tree, set query panel and grid read-only at the selected revision.
- Remove the per-dataset top-level grid entry point if it only duplicated "all records of a dataset"; keep
  a dataset filter in the tree/search if editors still need it (decide with the existing UX, note it).

## Acceptance criteria

- [ ] Vitest specs: tree node rendering (count, invalid badge), query panel validation state machine
      (debounce, diagnostics, match count, dirty/revert), grid mode toggle and dimming, create-dialog
      payloads, move-target filtering by dataset.
- [ ] Manual check in the running app (see memory "Running StaticForge locally"): create set → add records
      → edit query → grid reflects it; time travel is read-only.
- [ ] `npm run build` green, no new warnings beyond the known budget ones.

## Out of scope

- Record templates (`M25.5.2`), pickers/search (`M25.5.3`), drag-and-drop ordering.

## Notes / hazards

- `record-autosave.service` keys on the record uuid — unchanged, but its create path must now pass
  `recordSetUuid`.
- Use signal inputs/`OnPush` like the existing content components; the vitest runner caveats from
  commit `11a848a` apply.
