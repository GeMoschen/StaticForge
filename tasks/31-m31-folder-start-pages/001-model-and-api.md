---
id: M31.1
status: todo
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

- [ ] `FolderStartPageApiIntegrationTest`: set, read back in the tree and in the PATCH response, clear with `null`.
- [ ] Roles: viewer `403`, editor allowed, stranger `404`; archived project `409 SF-DOM-0141`; missing `If-Match`
      `412`, stale `If-Match` `409 SF-API-0409`.
- [ ] Refusals: a page of another folder, a non-page asset, an unknown uuid (`422`); a non-PAGES folder and the hidden
      `root` (`422`); `pages_root` allowed.
- [ ] Index claim: a page `index` in the folder refuses another start page with `409 SF-DOM-0111` naming it; making the
      `index` page itself the start page is allowed.
- [ ] The `START_PAGE` edge appears in the page's usages; releasing the folder proposes its unreleased start page.
- [ ] Deleting the start page is allowed without `force` (the edge doesn't block it).
- [ ] The revision history shows the change; the earlier folder version keeps its payload.
- [ ] `./gradlew build` green; OpenAPI and `schema.d.ts` regenerated; `ng build` + `vitest` green.

## Out of scope

- Output paths (M31.2), consumers (M31.3), planner edge and export/import (M31.4), UI (M31.5).

## Notes / hazards

- Adding an enum constant to `ReferenceKind` is safe for storage (`VARCHAR(30)`, no check constraint). The planner's
  generic referrer walk (`RebuildExpansion.Walk.visit`) sees `START_PAGE` rows like any other; M31.4 owns what they
  mean there.
