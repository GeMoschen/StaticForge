---
id: M11.1.3
status: todo
depends: [M11.1.1, M11.1.2]
epic: m11-store-coverage-and-provenance
feature: store-coverage
area: backend
---

# M11.1.3 — One-click "select entire store"

## Context

Today, exporting an entire store (e.g. every Page) means enumerating every
one of that store's top-level folder UUIDs into `ExportSelection.assetUuids`
— there's no single value meaning "everything currently under Pages." There
*is* a single hidden root folder per project (`PathService.ROOT_UID =
"root"`), but it parents **all three stores at once** and is deliberately
filtered out of every existing `GET /folders` response
(`FolderServiceImpl.tree`'s `hiddenRootId` logic) — it is internal plumbing
(spec §10.2), not a UI-facing concept, and making it independently pickable
would blur "whole store" with "whole project" and leak an implementation
detail into the API. This task adds "whole store" as a **derived expansion**
instead, scoped per `FolderScope`, without touching the hidden-root convention.

## Goals

- `ExportSelection` gains a new field, e.g. `Set<FolderScope> fullStores`
  (default/empty = today's behavior, unaffected).
- `ProjectExportImportServiceImpl.exportSelection` expands each named scope
  in `fullStores` into that scope's *current* top-level folder ids — reuse
  `FolderService.tree(projectId, scope, 0, ctx)` (or the equivalent
  lower-level query it already uses) to get exactly the same top-level set a
  `GET /folders?scope=X` call would return, rather than writing a second,
  possibly-drifting query. Union these ids into the same explicit-pick set
  `resolveIncludedAssetIds` already builds from `assetUuids`, before the
  existing subtree/ancestor expansion runs (so a whole-store pick behaves
  identically to manually ticking every top-level folder in that store).
- Update the empty-selection validation (`M10.1.1`): reject only when
  `assetUuids` is empty/null **and** `fullStores` is empty **and** both
  settings flags are false.

## Acceptance criteria

- [ ] `fullStores = {PAGES}` exports every live page/page-folder and nothing
      from Media/Navigation.
- [ ] Combining `fullStores` with an explicit `assetUuids` pick works (union,
      no duplicate entries in the resulting archive).
- [ ] `fullStores = {PAGES, MEDIA, NAVIGATION}` produces the same asset set
      `exportProject`'s "everything" wrapper would (settings flags aside).
- [ ] An empty `assetUuids`, empty `fullStores`, and both settings flags off
      is still rejected exactly as before.

## Out of scope

- Exposing the hidden project root itself as a pickable id — deliberately
  rejected, see Context above.
- A "select the entire project" single control — three `fullStores` entries
  already cover that; no new concept needed.
- Templates — they have no `FolderScope`/tree, so this mechanism doesn't
  apply to them (see `M11.1.2`'s Out of scope note).

## Notes / hazards

- Don't introduce a second "what are this store's top-level folders" query —
  reuse whatever `FolderService`/`FolderServiceImpl.tree` already does
  internally, so this can never drift from what the Pages/Media/Navigation
  folder-tree endpoints themselves would show a user.
