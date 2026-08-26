---
id: M8.1.5
status: done
depends: [M8.1.3]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.5 — Navigation store REST API

## Context

Expose the navigation store the same way Pages/Media are exposed: folder CRUD (reusing
the generic folder endpoints, scoped to `NAVIGATION`) plus `PageReference` CRUD, so the
UI (`M8.1.6`) has something to bind to.

## Goals

- `NavigationController` (or extend the existing generic folder controller with the
  `NAVIGATION` scope if one already parameterizes by scope — check before adding a
  parallel controller):
  - `GET /projects/{projectKey}/navigation/tree` — full folder tree with resolved
    `startNode` hrefs (via `NavigationService.tree`).
  - `POST /projects/{projectKey}/navigation/folders` — create folder (parent uuid,
    displayName).
  - `PATCH /projects/{projectKey}/navigation/folders/{uuid}` — rename / set `startNode`
    (`If-Match` optimistic concurrency, matching Pages/Media conventions).
  - `POST /projects/{projectKey}/navigation/folders/{uuid}/move`.
  - `DELETE /projects/{projectKey}/navigation/folders/{uuid}` — cascade behavior
    matches `FolderService.delete`.
  - `POST /projects/{projectKey}/navigation/references` — create `PageReference`
    (target kind + uuid, optional label override).
  - `PATCH /projects/{projectKey}/navigation/references/{uuid}` — update target/label.
  - `DELETE /projects/{projectKey}/navigation/references/{uuid}`.
  - `GET /projects/{projectKey}/navigation/references/{uuid}/resolve` — resolved page
    uuid + path, for the UI's live preview (`NavigationService.resolve`).
- DTOs mirror the Page/Media API's shape conventions (summary vs. detail, revision/etag
  fields) — do not invent a new response shape style.
- OpenAPI schema updated (generated client used by the Angular `*.service.ts` files
  depends on this).

## Acceptance criteria

- [x] Full CRUD + move + resolve endpoints implemented, authorized the same way as the
      Pages API (project role checks).
- [x] `If-Match`/optimistic-concurrency enforced on every mutating endpoint.
- [x] OpenAPI schema regenerates cleanly and the frontend's generated
      `components['schemas']` types include the new navigation types.
- [x] Integration tests cover create/rename/move/delete and reference target
      validation errors (400 on dangling/wrong-kind target).

## Out of scope

- UI (`M8.1.6`), URL registry endpoints (`M8.2.4`).

## Notes / hazards

- Check whether folders already have a scope-parameterized generic controller before
  writing a second one — Pages/Media may already expose `/folders` per scope, in which
  case only the `PageReference`-specific endpoints and the tree/resolve reads are new.

### Resolution notes (M8.1.5 implementation)

**A generic, scope-parameterized folder controller already existed** —
`server/sf-api/src/main/java/com/acme/staticforge/api/FolderController.java`, mounted at
`/api/v1/projects/{projectKey}/folders`, already handled create/rename/move/delete/tree for
*any* `FolderScope` via a `scope` query param (GET tree) or request-body field (POST create).
It required **zero code changes** to accept `NAVIGATION` — `parseScope` already did a plain
`FolderScope.valueOf(scope)`, so only its error message ("scope must be PAGES or MEDIA") and
two DTO javadocs (`FolderView`, `CreateFolderRequest`) were stale and got corrected to mention
`NAVIGATION` too. Per this task's own "Notes/hazards" guidance, folder create/move/delete
were **not duplicated** under `/navigation/...` — only what's genuinely new for the
navigation store was added, in a new `NavigationController`
(`server/sf-api/src/main/java/com/acme/staticforge/api/NavigationController.java`, package
`com.acme.staticforge.api`, same package as every other REST controller so it can reuse the
package-private `ProjectRoleExpr`/`RevisionHeaders` helpers).

**Final endpoint list (all under `/api/v1/projects/{projectKey}`):**

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/folders?scope=NAVIGATION&depth=` | Generic folder tree (unchanged `FolderController`, now documented as also accepting `NAVIGATION`) | VIEWER |
| POST | `/folders` (body `scope:"NAVIGATION"`) | Create a navigation folder (unchanged `FolderController`) | EDITOR |
| PUT | `/folders/{uuid}` (body `displayName`) | Rename any folder incl. navigation (unchanged `FolderController`) | EDITOR |
| POST | `/folders/{uuid}/move` | Move a navigation folder (unchanged `FolderController`) | EDITOR |
| DELETE | `/folders/{uuid}?cascade=` | Delete a navigation folder (unchanged `FolderController`) | EDITOR |
| GET | `/navigation/tree?depth=` | Full resolved navigation tree from the project's single navigation-root folder, via `NavigationService.tree` | VIEWER |
| PATCH | `/navigation/folders/{uuid}` | Rename a navigation folder and/or set/clear its `startNode` (`If-Match` required) — new, since the generic `FolderService.update` is display-name-only | EDITOR |
| POST | `/navigation/references` | Create a `PageReference` | EDITOR |
| PATCH | `/navigation/references/{uuid}` | Update a `PageReference`'s target/label (`If-Match` required) | EDITOR |
| DELETE | `/navigation/references/{uuid}?force=` | Delete a `PageReference` (validates the uuid is actually a live `PAGE_REFERENCE` first, then delegates to `AssetService.softDelete` — no `If-Match`, matching the existing convention that neither `FolderController.delete` nor the generic `AssetController.delete` require one) | EDITOR |
| GET | `/navigation/references/{uuid}/resolve` | Resolved page uuid + canonical path, via `NavigationService.resolve` | VIEWER |

The generic asset endpoints (`/api/v1/projects/{projectKey}/assets/{uuid}` — `GET` detail,
`GET .../usages`, `GET .../history`, `POST .../restore`, `PATCH .../uid`, `POST .../move`)
also already work for `PAGE_REFERENCE` assets with no changes, since `AssetController` is
generic over `AssetType`.

**Why `PATCH .../navigation/folders/{uuid}` takes a raw `JsonNode` body instead of a typed
record:** renaming and setting/clearing `startNode` needed to be independently optional in
one call (the UI edits them from different panels), which requires distinguishing "field
absent" (leave untouched) from "field explicitly `null`" (clear `startNode`) — a plain Jackson
record can't express that distinction, but `JsonNode.has("startNode")` vs. `.isNull()` can.
This mirrors the existing precedent for partial-update bodies in `PageController.patchContent`
(also a raw `JsonNode`). Revisions chain correctly when both fields are present in the same
call: the rename's returned `validFromRevision` becomes the `expectedRevision` fed into the
following `updateStartNode` call.

**DTO shapes** (all in `server/sf-api/src/main/java/com/acme/staticforge/api/dto/`, mirroring
`PageView`/`FolderView`'s summary-vs-detail and revision/etag conventions — every mutating
endpoint returns the same 200-with-body-plus-`ETag: "rev-N"` header shape `PageController`
uses, never a 201):

```java
record NavTreeView(UUID uuid, String type, String uid, String displayName, String label,
        UUID resolvedPageUuid, String resolvedPagePath, List<NavTreeView> children) {}

record NavigationFolderView(UUID uuid, String uid, String displayName, long revision,
        String folderPath, NavigationStartNodeView startNode) {}
record NavigationStartNodeView(String kind, UUID assetUuid) {}

record PageReferenceView(UUID uuid, String uid, String displayName, long revision,
        String folderPath, String targetKind, UUID targetAssetUuid, String label) {}
record CreatePageReferenceRequest(String displayName, UUID folderUuid, String targetKind,
        UUID targetAssetUuid, String label) {}
record UpdatePageReferenceRequest(String targetKind, UUID targetAssetUuid, String label) {}

record PageReferenceResolveView(UUID pageUuid, String path) {}
```

**"Resolved path" decision:** there is no URL registry yet (`M8.2`), so — per this task's own
instruction — `resolvedPagePath`/`path` reuse exactly the mechanism `PageView`/`AssetSummaryView`
already expose for a page's canonical location: `AssetVersionView.folderPath` (the page's
containing folder's materialized storage path, e.g. `/products/`), fetched via
`AssetService.requireCurrent(pageUuid)`. `M8.2`'s URL registry can replace this later without
touching any other field in these DTOs.

**Validation status codes:** `PageReferenceServiceImpl.requireValidTarget` (landed in `M8.1.2`/
`M8.1.3`, not touched here) already rejects a dangling or wrong-kind target with **422**
(`SF-DOM-0130` for a dangling `FOLDER` target, generic `SF-API-0422`/"Validation Failed" for
the others) — not 400 as this task's Goals text literally said. Confirmed the controller
surfaces this unchanged (`createReferenceRejectsADanglingTargetWith422` /
`createReferenceRejectsAWrongKindTargetWith422` in the new test class assert
`status().isUnprocessableEntity()`); no controller-level remapping to 400 was added, since 422
("Validation Failed", a well-formed request whose semantics are invalid) is the objectively
correct status per this codebase's own `ProblemFactory` conventions and every other validation
error in the domain layer already uses it — remapping would have been the actual bug.

**Tests:** `server/sf-app/src/test/java/com/acme/staticforge/NavigationApiIntegrationTest.java`
(5 tests, `@SpringBootTest` + `MockMvc`, fixture style mirrored from
`NavigationServiceIntegrationTest`/`NavigationDomainIntegrationTest`): full HTTP round-trip
(create reference → set folder `startNode` via PATCH → `resolve` → `tree` shows the resolved
page → rename/update reference → delete), dangling-target 422, wrong-kind-target 422,
EDITOR-role enforcement (a VIEWER member gets 403 on create, but can still read the tree), and
`If-Match` enforcement (missing header on a folder PATCH gets 412).

**Verification:** `./gradlew spotlessApply` then `./gradlew build` — full multi-module build
green (compile + spotless + all tests, sf-app's frontend bundle included).
`./gradlew :server:sf-app:generateOpenApi` regenerates cleanly and
`server/sf-app/build/openapi/openapi.json` (a build artifact, not committed — same as before
this task) includes all five new paths:
`/api/v1/projects/{projectKey}/navigation/tree`,
`/api/v1/projects/{projectKey}/navigation/folders/{uuid}`,
`/api/v1/projects/{projectKey}/navigation/references`,
`/api/v1/projects/{projectKey}/navigation/references/{uuid}`,
`/api/v1/projects/{projectKey}/navigation/references/{uuid}/resolve`.

**For `M8.1.6` (Angular UI, next task):** build `navigation.service.ts` against the endpoint
table above. Folder create/rename/move/delete go through the *existing* generic
`/folders?scope=NAVIGATION` endpoints (already used for Pages/Media — no new folder-CRUD
methods needed beyond pointing them at `NAVIGATION`); only `startNode` management, `PageReference`
CRUD, and the two resolved-read endpoints (`tree`, `resolve`) are new. The tree endpoint returns
a *single* root `NavTreeView` (not a list) since the project has exactly one navigation-root
folder (auto-created by `M8.1.2`) — there is no "pick a root" step in the UI.
