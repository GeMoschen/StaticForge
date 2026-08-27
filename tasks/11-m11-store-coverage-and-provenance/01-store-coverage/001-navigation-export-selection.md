---
id: M11.1.1
status: todo
depends: []
epic: m11-store-coverage-and-provenance
feature: store-coverage
area: backend
---

# M11.1.1 — Navigation entries reachable via selective export

## Context

`ProjectExportImportServiceImpl.resolveIncludedAssetIds` (`M10.1.1`) expands
a selection over `assetVersionRepository.findCurrentSnapshot(projectId)` with
no filtering by `AssetType` or `FolderScope` — a `NAVIGATION` folder should
already expand into its live descendants (including `PAGE_REFERENCE` assets)
exactly like a `PAGES`/`MEDIA` folder does today, and `NON_FOLDER_ORDER`
already lists `"PAGE_REFERENCE"` in the import ordering. This task is
primarily verification: prove it with an integration test, and only add code
where the test actually finds a gap.

## Goals

- New integration test (alongside `ProjectExportImportIntegrationTest.java`'s
  existing `M10.1`/`M10.2` tests) covering:
  - Selecting a `NAVIGATION` folder UUID exports that folder, its ancestors up
    to root, and every live `PAGE_REFERENCE`/sub-folder beneath it — same
    shape as the existing "folder selection" test for Pages.
  - Selecting a single `PAGE_REFERENCE` UUID (no folder) exports just that
    reference plus its ancestor folder chain, and on import its `target`
    payload (`target.assetUuid`) remaps correctly via the existing
    `UuidRemapper` machinery (which is payload-generic and shouldn't need any
    change — confirm this, don't assume).
- If either test fails, diagnose and fix the smallest real gap (e.g. an
  off-by-type assumption somewhere) — do not preemptively rewrite
  `resolveIncludedAssetIds` or `createImportedAsset` before a test proves a
  problem exists.

## Acceptance criteria

- [ ] Both new tests pass.
- [ ] If a gap was found and fixed, the fix is scoped to the specific
      incorrect assumption found, not a speculative rewrite.
- [ ] Existing `M10.1`/`M10.2` tests for Pages/Media selection remain
      unaffected and passing.

## Out of scope

- Navigation *resolution* behavior (`NavigationService`, `M8.1.3`) — this
  task is about export/import data fidelity only, not how a reference is
  resolved to a page at render time.
- The one-click "select entire Navigation store" convenience (`M11.1.3`).

## Notes / hazards

- If this task turns out to need zero code changes (both tests pass
  unmodified against the current `M10.1` implementation), that is a valid,
  expected outcome — say so plainly rather than inventing busywork. The
  acceptance criteria are about proven behavior, not lines changed.
