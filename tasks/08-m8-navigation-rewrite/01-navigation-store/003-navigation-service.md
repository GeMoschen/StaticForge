---
id: M8.1.3
status: todo
depends: [M8.1.2]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.3 — Navigation resolution service

## Context

`M8.1.2` models the data; this task implements the resolution algorithm that turns a
`PageReference` (or an intermediate navigation folder) into a concrete `Page` — the
"practically a redirect to the first node" behavior called out in the milestone brief —
and the tree-walk used by rendering (`M8.1.4`) and by the nav-store UI's live preview
(`M8.1.6`).

## Goals

- `NavigationService.resolve(pageReferenceUuid, snapshot|liveRepo) -> UUID` (resolved
  `Page` uuid):
  - `target.kind == PAGE` → return `target.assetUuid` directly.
  - `target.kind == FOLDER` → first navigable page of that folder: if the folder's
    first `PageReference`-equivalent... — no, `target` is a *page-store* folder, so
    "first navigable page" means the folder's direct child pages in the store's
    deterministic order (matches whatever ordering Pages already use for folder
    listings); recurse into subfolders only if the folder itself has no direct pages.
  - Dead folder (no pages anywhere in its subtree) is a validation-time error, not a
    render-time failure — reject such a `PageReference` at save time in `M8.1.2`'s
    validation, not here.
- `NavigationService.resolveFolderEntry(navFolderUuid, snapshot|liveRepo) -> UUID`: if
  `startNode` is set, resolve through it (a `PAGE_REFERENCE` startNode delegates to the
  method above; a `FOLDER` startNode recurses into this same method); if `startNode` is
  `null`, the folder has no entry page (grouping-only) and callers must not link it.
- `NavigationService.tree(navFolderUuid, depth, snapshot|liveRepo) -> NavNode` (or
  equivalent record) for rendering/preview: nested structure of folders/`PageReference`s
  with each entry's resolved href pre-computed, mirroring the shape (not the class) of
  the old `NavNode`.
- Cycle protection on `startNode` chains (a folder's `startNode` chain must not revisit
  a folder) — reuse the "track visited UUIDs, truncate + diagnostic" pattern from the
  deleted `NavigationBuilder`, under a new diagnostic code (`SF-GEN-04xx`, pick the next
  free number in that range).
- Works against **both** a revision-pinned `Snapshot` (generation) and the live
  repositories (preview) — same dual-path split as `GenerationRenderer` vs.
  `PageRenderService` (§ M4/M6 pattern); do not hardcode `Snapshot`.

## Acceptance criteria

- [ ] `resolve` returns the correct page for direct, one-level-folder, and
      nested-folder-with-no-direct-pages cases.
- [ ] `resolveFolderEntry` returns `empty`/`null` (not an exception) for a `null`
      `startNode`, and resolves correctly through a `PAGE_REFERENCE` or `FOLDER`
      `startNode`.
- [ ] A `startNode` cycle is detected, truncated, and reported via a new diagnostic
      code — never a stack overflow or infinite loop.
- [ ] Identical results whether resolution runs against a `Snapshot` or live
      repositories, proven by a shared test fixture run through both paths.

## Out of scope

- OCTL wiring (`M8.1.4`), REST exposure (`M8.1.5`).

## Notes / hazards

- Reuse `PathService.MAX_DEPTH` or an equivalent bound as a hard recursion cap
  independent of cycle detection, in case of a very deep-but-acyclic chain.
