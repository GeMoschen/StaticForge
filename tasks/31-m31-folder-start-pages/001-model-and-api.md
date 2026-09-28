---
id: M31.1
status: done
depends: []
epic: m31-folder-start-pages
feature: model-and-api
area: backend
---

# M31.1 — Start page model and API

## Context

`asset/folder/StartNode.java`, `FolderServiceImpl.updateStartNode` and `NavigationController.updateFolder` (the pattern
to mirror), `FolderController` / `FolderView` / `FolderNode`, `ReferenceMaterializer` (FOLDER case), `ReferenceKind`,
`AssetServiceImpl.isReferencedByLiveAssets`, `ReleaseServiceImpl.Dependencies` (release closure),
`ChannelService.outputSettings(projectId)`. Epic decisions 1–5, 13.

## Goals

- `StartPage.fromPayload(JsonNode) → UUID|null` and the payload key constant; malformed values read as none.
- `FolderService.updateStartPage(UUID folderUuid, UUID pageUuid, long expectedRevision, RevisionContext ctx)`:
  - folder: live `FOLDER` of the project (`404` unknown/deleted), scope `PAGES` (`422` otherwise, which also covers the
    hidden `root`); protected folders allowed (`pages_root`);
  - page (when not `null`): a live `PAGE` of the project whose current `folderId` is this folder (`422` otherwise);
  - index claim conflict: `409 SF-DOM-0111` when another live page directly in the folder has a UID equal to the index
    stem of any project channel; properties `conflictingPageUuid`, `conflictingPageUid`;
  - writes a deep copy of the payload with `startPage` set or `null` through `assetService.update` (revision, summary,
    `If-Match`); an unchanged value writes nothing but still checks the revision.
- `PATCH /api/v1/projects/{key}/folders/{uuid}` `{startPage: uuid|null}`, `If-Match`, role `EDITOR`, answers
  `FolderView` + `ETag`; archived projects refused by the M26 guard.
- `FolderView.startPageUuid` (nullable) from `FolderNode.startPage` in the tree and from the payload in single-folder
  responses; `null` for non-PAGES folders.
- `ReferenceKind.START_PAGE` edge folder → page (source path `startPage`) for FOLDER assets.
- The delete guard ignores `START_PAGE` edges.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] `FolderStartPageApiIntegrationTest`: set, read back in the tree and in the PATCH response, clear with `null`.
- [x] Roles: viewer `403`, editor allowed, stranger `404`; archived project `409 SF-DOM-0141`; missing `If-Match`
      `412`, stale `If-Match` `409 SF-API-0409`.
- [x] Refusals: a page of another folder, a non-page asset, an unknown uuid (`422`); a non-PAGES folder and the hidden
      `root` (`422`); `pages_root` allowed.
- [x] Index claim: a page whose UID is the index file stem refuses another start page with `409 SF-DOM-0111` naming
      it; making that page itself the start page is allowed; an `indexUid` page is no conflict.
- [x] The `START_PAGE` edge appears in the page's usages; releasing the folder proposes its unreleased start page.
- [x] Deleting the start page is allowed without `force` (the edge doesn't block it).
- [x] The revision history shows the change; the earlier folder version keeps its payload.
- [x] `./gradlew build` green; OpenAPI and `schema.d.ts` regenerated; `ng build` + `vitest` green.

## Out of scope

- Output paths (M31.2), consumers (M31.3), planner edge and export/import (M31.4), UI (M31.5).

## Notes / hazards

- Adding an enum constant to `ReferenceKind` is safe for storage (`VARCHAR(30)`, no check constraint). The planner's
  generic referrer walk (`RebuildExpansion.Walk.visit`) sees `START_PAGE` rows like any other; M31.4 owns what they
  mean there.
- Seams: `FolderService.updateStartPage(UUID folderUuid, UUID pageUuid, long expectedRevision, RevisionContext)`;
  `StartPage.fromPayload(JsonNode)`, `StartPage.PAYLOAD_KEY` (`"startPage"`); `FolderNode.startPage()`;
  `FolderView.startPageUuid`; `UpdateFolderRequest` (`startPage`, explicit `null` clears, absent keeps);
  `ReferenceKind.START_PAGE` (source path `startPage`); `FolderServiceImpl.INDEX_CLAIM_CONFLICT` = `SF-DOM-0111`
  (409, properties `conflictingPageUuid`, `conflictingPageUid`).
- Deviation: the index claim conflict counts only pages whose UID equals a channel's index file **stem**, not those
  whose UID equals `indexUid`: next to a start page an `indexUid` page renders under its own UID (user decision 2), so
  it claims nothing. Note that `index` is a reserved UID (`UidGenerator`), so with default settings no page can claim
  `index.html` by UID; the check matters for channels with another `indexFileName` (tested with `start.html`).
- Deviation: `PATCH` without an `If-Match` answers `412 SF-API-0412` even for a body without `startPage` (the header is
  parsed first, like every revisioned write).
- Evidence: `FolderStartPageApiIntegrationTest` (8 tests); `ng build` and `npx vitest run` (121 files, 821 tests) green
  after regenerating `schema.d.ts` (the generator also reorders a few `Page*` properties and renumbers `update_N`
  operation ids; nothing in the UI references them).
