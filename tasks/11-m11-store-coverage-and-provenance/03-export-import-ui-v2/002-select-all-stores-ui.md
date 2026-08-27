---
id: M11.3.2
status: todo
depends: [M11.1.3, M11.3.1]
epic: m11-store-coverage-and-provenance
feature: export-import-ui-v2
area: frontend
---

# M11.3.2 — "Select entire store" one-click controls

## Context

`M11.1.3` adds `ExportSelection.fullStores` so the backend can express "the
whole Pages/Media/Navigation store" without enumerating every top-level
folder. Today's tri-state tree picker (`M10.3.2`) can only compute a folder's
checked/indeterminate state from folders the user has already expanded
(lazy-loaded) — it cannot represent "everything" without walking the whole
tree client-side. This task adds a dedicated one-click control per store that
bypasses that limitation entirely.

## Goals

- A toggle/button per store section (Pages, Media, Navigation), e.g. "Select
  all Pages", that when activated adds that scope to a `fullStores` set on
  the component and is sent as `ExportSelectionRequest.fullStores` (extend
  the request type/service accordingly) — **without** requiring the tree to
  have been expanded or loaded at all.
- Visually reflect the whole-store selection in that store's tree (e.g. every
  visible top-level folder renders checked) without needing to fetch
  descendants just to render that state — the visual is a consequence of the
  store-level flag, not computed from individually-tracked descendant UUIDs.
- Decide, and document in code, how per-item toggling interacts with an
  active store-level selection (e.g. unchecking one item under an active
  "select all" either clears the store-level flag back to manual per-item
  mode, or is disabled while the store-level toggle is active) — pick
  whichever reads less surprising given `M10.3.2`'s existing tri-state
  conventions.

## Acceptance criteria

- [ ] Clicking "Select all Pages" and exporting sends `fullStores: ['PAGES']`
      without any folder in that store ever having been expanded.
- [ ] The chosen per-item/store-level interaction (see Goals) is consistent
      and does not produce a request that both sets `fullStores` for a scope
      and duplicates that scope's items in `assetUuids`.

## Out of scope

- A single "select entire project" super-control — three per-store toggles
  already cover it.
- Templates — no store/tree concept applies to them (`M11.1.2`), so no
  "select all templates" control is part of this task.

## Notes / hazards

- Keep this visually and interactively distinct from the per-folder tri-state
  checkboxes (`M10.3.2`) — it's a coarser, store-wide concept, not another
  tree node.
