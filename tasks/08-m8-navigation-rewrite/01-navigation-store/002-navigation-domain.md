---
id: M8.1.2
status: done
depends: [M8.1.1]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.2 — Navigation store domain model

## Context

Model the navigation store the same way Pages and Media are modeled: a `FolderScope`
partition of the shared `Folder`/`PathService` machinery, plus a new asset type for the
leaf nodes. Unlike Pages, a navigation folder itself carries navigation-relevant state
(`startNode`), and the leaf asset (`PageReference`) is a pointer, not content.

## Goals

- Add `FolderScope.NAVIGATION` to the existing `FolderScope` enum; root creation on
  project create follows the same path as the Page/Media store roots (`PathService`,
  `ROOT_PATH`/`ROOT_UID` conventions) — the navigation root is a normal folder, not a
  special-cased node.
- Extend the navigation folder's payload with a single new field: `startNode` —
  nullable reference (`{ kind: PAGE_REFERENCE | FOLDER, assetUuid }`) to a child within
  the same folder. `null` means the folder itself is not directly navigable (pure
  grouping node).
- Add `AssetType.PAGE_REFERENCE`. Payload:
  - `target.kind`: `PAGE | FOLDER` (the *page-store* folder scope, i.e.
    `FolderScope.PAGES`, not a navigation folder).
  - `target.assetUuid`: the referenced `Page` or page-store `Folder`.
  - Optional `label` override (falls back to the target's `displayName` when absent —
    mirrors §17.1's `coalesce(nav.label, displayName)` behavior from the old grammar).
- Document (in this file's Notes) the resolution rule used by `M8.1.3`: a
  `PAGE`-targeted reference is direct; a `FOLDER`-targeted reference resolves to that
  folder's first navigable page, and a navigation folder's own `startNode` — when set —
  is what makes an intermediate nav folder itself clickable/linkable.

## Acceptance criteria

- [x] A project's navigation root folder is auto-created on project create, alongside
      the existing Page/Media roots, using the shared `FolderService`/`PathService`.
- [x] Navigation folders support create/rename/move/delete through the generic
      `FolderService`, scoped to `NAVIGATION`, with the same revisioning as other
      folders.
- [x] `PageReference` create/update round-trips through `AssetService` with
      `RevisionContext`, validated against the CDL-less fixed payload shape above (no
      CDL involved — this is not a content-editable asset).
- [x] Validation rejects a `PageReference` whose `target.assetUuid` does not exist or is
      not the declared `target.kind`.
- [x] Validation rejects a folder `startNode` pointing outside that folder's direct
      children.

## Out of scope

- Resolving a folder-targeted reference to a concrete page (service-layer concern,
  `M8.1.3`).
- Rendering (`M8.1.4`), API surface (`M8.1.5`), UI (`M8.1.6`).

## Notes / hazards

- Two distinct "pointer" concepts exist and must not be conflated: (1) `PageReference →
  Folder` resolves to that folder's *first navigable page* (content-store lookup); (2)
  navigation `Folder.startNode` resolves to *a child within the nav tree itself*
  (nav-store lookup). Keep them as separate fields/types even though both are nullable
  references.
- `PathService.MAX_DEPTH` (12) applies to navigation folders too — no special-casing.

### Resolution notes (M8.1.2 implementation)

**Final shapes landed (M8.1.3–M8.1.6 build on these — names are load-bearing):**

- `FolderScope.NAVIGATION` added to
  `server/sf-domain/.../asset/folder/FolderScope.java`. `FolderScope.requiredFor(AssetType)`
  now maps `PAGE_REFERENCE -> NAVIGATION` alongside the existing `PAGE -> PAGES`,
  `MEDIA -> MEDIA`.
- `AssetType.PAGE_REFERENCE` added to `server/sf-domain/.../asset/AssetType.java`. No
  Liquibase changelog was needed — `asset.asset_type` is a plain `VARCHAR(30)` with no DB
  check constraint (confirmed by reading `002-assets.xml`), so a new enum constant is a
  pure application-level change.
- Navigation folder payload (a `FOLDER` asset with `payload.scope = "NAVIGATION"`) gained
  one optional field:
  ```json
  { "scope": "NAVIGATION", "startNode": { "kind": "PAGE_REFERENCE" | "FOLDER", "assetUuid": "<uuid>" } }
  ```
  `startNode` is `null`/absent for a pure grouping node. New types:
  `com.acme.staticforge.asset.folder.StartNodeKind` (enum `PAGE_REFERENCE | FOLDER`) and
  `com.acme.staticforge.asset.folder.StartNode` (record `(StartNodeKind kind, UUID assetUuid)`,
  with a `StartNode.fromPayload(JsonNode)` reader mirroring `FolderScope.fromPayload`).
  Mutated via a new `FolderService.updateStartNode(UUID folderUuid, StartNode startNode,
  long expectedRevision, RevisionContext ctx)` (implemented in `FolderServiceImpl`) — chosen
  over overloading `FolderService.update` because `update` is display-name-only for every
  other folder scope and `startNode` only ever applies to `NAVIGATION` folders (rejected
  with 422 on any other scope).
- `PAGE_REFERENCE` payload shape:
  ```json
  { "target": { "kind": "PAGE" | "FOLDER", "assetUuid": "<uuid>" }, "label": "<string>" | null }
  ```
  `target.kind = "FOLDER"` means a page-store (`FolderScope.PAGES`) folder — never a
  navigation folder. `label` is `null` when absent (coalescing onto the target's
  `displayName` is a render-time concern for `M8.1.3`, not stored here). New package
  `com.acme.staticforge.asset.navigation` (mirrors `asset.page`'s shape):
  `PageReferenceTargetKind` (enum `PAGE | FOLDER`), `PageReferenceTarget` (record, currently
  informational — the payload is hand-built/read as raw JSON rather than via this record,
  same as how `asset.page` doesn't (de)serialize its payload through a record either),
  `CreatePageReferenceCommand` (record `(String displayName, UUID folderUuid,
  PageReferenceTargetKind targetKind, UUID targetAssetUuid, String label)`),
  `PageReferenceService` / `PageReferenceServiceImpl` (mirrors `PageService`/`PageServiceImpl`:
  `create(CreatePageReferenceCommand, RevisionContext)`, `update(UUID, PageReferenceTargetKind,
  UUID, String label, long expectedRevision, RevisionContext)`, `find(UUID)`), each validating
  the target (exists, not soft-deleted, correct asset type, and — for `FOLDER` — correct
  `FolderScope.PAGES`) before delegating to the generic `AssetService.create`/`update`.
- Navigation root auto-creation: `ProjectServiceImpl.create` now also calls
  `folderService.create(null, "Navigation", FolderScope.NAVIGATION, ctx)` right after
  `channelService.ensureDefaultChannels(...)`. This is a *normal* folder — same
  `FolderService.create` path, same optimistic-concurrency/revisioning, no special-casing —
  exactly as the acceptance criterion asks.

**Deviation found and made — read this before M8.1.3–M8.1.6 assume "the Page/Media roots" exist:**
Investigated where the *existing* Page/Media store root folders get auto-created on project
bootstrap, as this task's Context/Notes assume. They don't exist. `ProjectServiceImpl.create`
never created a Page or Media root folder before this task; `AssetServiceImpl.ensureRootFolder`
only lazily creates one *hidden, unscoped* sentinel folder (`uid = "root"`, `path = "/"`)
the first time any asset needs a parent and none was given — Pages/Media simply live as
scope-stamped folders/assets directly under that hidden sentinel, with no dedicated
"Pages"/"Media" folder object ever required to exist. `FolderServiceImpl.tree()` lists
top-level `PAGES`/`MEDIA` folders by filtering the hidden sentinel's children by scope, which
works with zero or many top-level folders — there is nothing today for a navigation root to
sit "alongside".

Given the acceptance criterion explicitly requires *eager* auto-creation of a navigation root
on project create (unlike Pages/Media), and doing so is unambiguously in scope for this task
while retrofitting eager Page/Media roots is not (out of scope, unrequested, and a much bigger
blast radius), the call made was: **add eager creation for the `NAVIGATION` scope only**, via
the same `FolderService`/`PathService` machinery Pages/Media *would* use if they had eager
roots. Page/Media remain exactly as they were (lazy, unscoped hidden sentinel, no wrapper
folder). This satisfies the literal criterion text and gives `M8.1.3`+ a single well-known
navigation folder per project to build the resolver/render/API/UI around, without changing
Page/Media behavior no task has asked to change.

**Side effects of eager root creation (fixed in this task, note for anyone touching these
tests again):**
- `ProjectServiceImpl.create` now allocates 3 revisions per project instead of 1: the
  project's own `CREATE` (revision 1), the lazy hidden-root `FOLDER` `CREATE` (first asset
  ever created in a fresh project), and the navigation-root `FOLDER` `CREATE`,
  `ProjectApiIntegrationTests.createAllocatesRevisionOneAndGrantsCreatorProjectAdmin` updated
  accordingly (asserts revision id 1 is still the project's own `CREATE`, and that all 3
  allocated revisions are `CREATE`).
- `ProjectExportImportIntegrationTest.roundTripPreservesAssetsAndMediaRemapsUuidsAndAddsProvenance`'s
  `importedAssetCount()` moved from 4 to 5 — the source project's auto-created navigation
  root folder is now exported/imported like any other folder (no special-casing needed;
  `UuidRemapper` and the existing `FOLDER`-then-`NON_FOLDER_ORDER` import ordering already
  handle it generically). Also added `"PAGE_REFERENCE"` to
  `ProjectExportImportServiceImpl.NON_FOLDER_ORDER` (after `"PAGE"`, since a `PAGE_REFERENCE`
  can target a `PAGE`) so future `PageReference` assets round-trip through export/import too.

**Known gap flagged for M8.1.3 (not fixed here — genuinely out of scope):** `PageReference`
targets are *not* materialized into the `asset_reference` table (no `usages()` tracking, no
delete-blocking protection when a `Page`/`Folder` that a `PageReference` points at is
soft-deleted). `ContentReferenceService.materialize` — the existing mechanism for this — only
scans CDL `content` payloads for `MEDIA_REF`/`ASSET_REF`/`{kind: INTERNAL|MEDIA}` markers,
which a `PAGE_REFERENCE`'s fixed `target.kind: PAGE|FOLDER` shape doesn't match and was not
adapted to match (out of scope for a "no CDL involved" leaf asset, per this task's own
framing). `M8.1.3`'s resolver should decide whether dangling targets are handled entirely at
render time (skip/omit) or whether reference materialization needs to be added at that point.

**Resolution-rule split for `M8.1.3` (documented per this task's Goals, not implemented):**
Two distinct "pointer" concepts exist and must stay separate types even though both are
nullable references:
1. `PageReference.target` (page-store pointer) — a `PAGE`-targeted reference is direct (the
   page itself); a `FOLDER`-targeted reference (a `FolderScope.PAGES` folder) resolves at
   render time to that folder's *first navigable page* (content-store lookup, definition of
   "first navigable" is `M8.1.3`'s to make — e.g. by nav position/order — not defined here).
2. `Folder.startNode` (nav-store pointer) — resolves to *a child within the navigation tree
   itself* and is what makes an intermediate nav folder itself clickable/linkable when
   rendering the tree; `null` means the folder is a pure grouping node. This is never a
   content-store lookup.

**Frontend:** confirmed no `ui/` changes were needed — this is a pure backend domain-model
task (new enum constants, new payload fields/validation, one extra service call in
`ProjectServiceImpl.create`). The frontend build was exercised as part of `./gradlew build`
(it bundles the Angular app into `sf-app`) and is untouched/green; no navigation-specific UI
exists yet (that's `M8.1.6`).

**Verification:** `./gradlew spotlessApply` then `./gradlew clean build` — full multi-module
build (all modules, all tests, spotless) green. Added
`server/sf-app/src/test/java/com/acme/staticforge/NavigationDomainIntegrationTest.java`
(7 tests, mirrors `AssetRevisionIntegrationTests`' fixture/service-level integration style
since `FolderService`/`PageReferenceService` need real repositories — the pure-unit-test style
under `sf-domain/src/test/.../asset/` doesn't apply to DB-backed service validation) covering:
navigation root auto-creation, `PageReference` create/update round-trip (including the
`label` defaulting to `null`), dangling-target rejection, wrong-kind-target rejection (all
three directions: `PAGE`-declared-but-Folder, `FOLDER`-declared-but-Page,
`FOLDER`-declared-but-navigation-folder), `startNode` accept/clear on a direct child,
`startNode` rejection on a non-direct-child, and `startNode` rejection on a non-`NAVIGATION`
folder.
