---
id: M31.4
status: done
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

- [x] Incremental test: setting / changing / clearing a start page re-renders the old and new start page, the
      `indexUid` page, their linkers and navigation; nothing else. Rebuild reasons show `START_PAGE`.
- [x] Moving the start page out of its folder re-renders the folder's `indexUid` page.
- [x] AUTO redirect `homepage.html → Homepage` after it became the start page; old `index.html` entry shadowed.
- [x] Export/import round trip (full and selective) keeps `startPage` on folders and `pages_root`; conflict entry when
      the target's `pages_root` already has a different one; protocol-10 archive imports.
- [x] `./gradlew build` green.

## Out of scope

- Output paths themselves (M31.2), link consumers (M31.3), UI (M31.5).

## Notes / hazards

- M31.1 makes the generic walk follow `START_PAGE` rows page → folder like any reference row; a folder reached that
  way is "not changed" and only follows `NAV` rows to page references (`walkReachedFolder`). Replace that with the
  explicit rule above.
- Decision (incoming `START_PAGE` rows): the generic referrer loop follows a page → folder `START_PAGE` row only when
  the folder's *effective* start page differs from the baseline (`Walk.startPageChanged`: pointer changed, or the
  named page moved into/out of the folder, was deleted, unpublished or released — compared via `changes.before`).
  Such a folder (root or reached) reaches its current and baseline start pages (`sourcePath` `startPage`) and its
  `indexUid` pages (`sourcePath` `indexUid`) over `RebuildEdgeKind.START_PAGE`, then walks every referrer (folder
  links, page references pointing at it, which count as navigation-visible). A content edit of a start page no longer
  reaches its folder. The reason chain of the page → folder step is the existing `REFERENCE`/`START_PAGE` edge.
- Deviation: a reached page whose output moved (not only a changed one) is now navigation-visible — it reaches its
  pages folders over `NAVIGATION` and its page references count as pointing at a navigation-visible change; before,
  such a page only walked to its linkers, so navigation kept the old href until something else changed. Needed for
  "their `outputMoved` walks on to … navigation".
- The walk needs the channels' `indexUid`s: `RebuildExpansion.expandSince/expand` take `Set<String> indexUids`,
  filled by `OutputPathResolver.indexUids(channels)` (planned channels in `BuildPlanner`, the impact's channels in
  `ImpactService`). An upper-bound impact treats the pages reached over `START_PAGE` as moved.
- Redirects needed no code. After a swap the old start page's first entry (`homepage.html → Homepage`) points at the
  page's own path again and resolves as `LOOP` (M30 rule order: loop before shadowed) — never emitted.
- Navigation hrefs come from the URL registry: `navpage` is re-rendered here, but its href only changes once M31.3's
  registry invalidation is merged; the incremental test asserts the plan, not the nav href.
- Import: `START_PAGE_NOT_MERGED` (WARNING) — the target's `pages_root` keeps a different effective start page, or
  the archive's start page won't be a live page of the site root after the import (named by uuid when neither side
  knows it). The merge writes through `assetService.update` (own revision after the import's), not
  `FolderService.updateStartPage`, whose `SF-DOM-0111` check would refuse the whole import; a later index claim is the
  build's `SF-GEN-0110` backstop. The merge is gated on protocol ≥ 11 (`START_PAGE_PROTOCOL`).
- Folder links: `$CMS_REF(folder:F)` is an `OCTL_REF` row template → F, so a folder whose effective start page
  changed reaches its linkers over the generic referrer walk (`folderLinkersRebuild`). The import writes normal folder
  payloads through `createImportedAsset` (raw repositories): after merging with M31.3, an overwritten folder whose
  `startPage` changes calls `StartPageUrlInvalidation.payloadChanged` once all edges are materialized (done after the merge; test
  `importInvalidatesCachedNavigationHrefs`).
