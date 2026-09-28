---
id: M31.4
status: todo
depends: [M31.2]
epic: m31-folder-start-pages
feature: planner-redirects-import
area: backend
---

# M31.4 — Planner edge, redirects, export/import protocol 11

## Context

`RebuildExpansion.Walk.visit` (FOLDER case, generic referrer walk), `RebuildEdgeKind`, `BuildPlanner.moved`,
`ImpactService`, `BuildRedirects.candidate` (AUTO redirects), `ProjectExportImportServiceImpl` (fixed roots skipped on
import), `ProjectExportImportService.QUALITY_AND_REDIRECTS_PROTOCOL`, `UuidRemapper`. Epic decisions 10, 11.

## Goals

- `RebuildEdgeKind.START_PAGE`: a changed PAGES folder reaches its current and baseline (`changes.before(folderId)`)
  start pages and its `indexUid` page(s); their `outputMoved` walks on to linkers and navigation as today.
- Decide and document how the generic walk treats incoming `START_PAGE` rows (page → folder): a changed start page
  (moved away, deleted, unpublished) must reach the folder's `indexUid` page that takes over the index path.
- Redirects: no new code expected — prove AUTO `homepage.html → page` and the old start page's `index.html` entry
  `SHADOWED` by the new start page.
- Export/import: folder payloads carry `startPage`; the archive's `pages_root` start page is merged into the target's
  `pages_root` when it has none (non-blocking conflict entry when it differs); protocol **11**, a protocol ≤ 10
  archive imports unchanged.

## Acceptance criteria

- [ ] Incremental test: setting / changing / clearing a start page re-renders the old and new start page, the
      `indexUid` page, their linkers and navigation; nothing else. Rebuild reasons show `START_PAGE`.
- [ ] Moving the start page out of its folder re-renders the folder's `indexUid` page.
- [ ] AUTO redirect `homepage.html → Homepage` after it became the start page; old `index.html` entry shadowed.
- [ ] Export/import round trip (full and selective) keeps `startPage` on folders and `pages_root`; conflict entry when
      the target's `pages_root` already has a different one; protocol-10 archive imports.
- [ ] `./gradlew build` green.

## Out of scope

- Output paths themselves (M31.2), link consumers (M31.3), UI (M31.5).

## Notes / hazards

- M31.1 makes the generic walk follow `START_PAGE` rows page → folder like any reference row; a folder reached that
  way is "not changed" and only follows `NAV` rows to page references (`walkReachedFolder`). Replace that with the
  explicit rule above.
