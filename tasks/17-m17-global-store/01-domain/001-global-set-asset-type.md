---
id: M17.1.1
status: todo
depends: [M16.3.1]
epic: m17-global-store
feature: domain
area: backend
---

# M17.1.1 — `AssetType.GLOBAL_SET`, `FolderScope.GLOBALS`, `globals_root` provisioning

## Context

`AssetType` (`server/sf-domain/src/main/java/com/acme/staticforge/asset/AssetType.java`)
is `PAGE, MEDIA, SECTION_TEMPLATE, PAGE_TEMPLATE, FOLDER, PAGE_REFERENCE`.
`FolderScope` (`asset/folder/FolderScope.java`) is `PAGES, MEDIA, NAVIGATION, TEMPLATES`:

- `requiredFor(AssetType)` maps each leaf type to its store.
- The protected store roots are `pages_root`, `media_root`, `navigation_root` and
  `templates_root`, plus the hidden shared `root` (`PathService.ROOT_UID`).
- The root uids are reserved in `UidGenerator` so no user-derived uid can collide with them.
- Roots are created by `AssetServiceImpl.ensure{Navigation,Pages,Media}RootFolder` and
  `ensureTemplateFolders`. `ProjectServiceImpl.create` calls these inside its
  `revisionService.beginBatch(…, ChangeType.CREATE, …)` (lines ~84–123), so a new project
  is one revision (`M15.2.1`).

The navigation store (`M8.1.2`) is the precedent: a new leaf type plus a scope, with
no new folder type.

## Goals

- Add `GLOBAL_SET` to `AssetType`.
- Add `GLOBALS` to `FolderScope`:
  - `GLOBALS_ROOT_UID = "globals_root"`, reserved in `UidGenerator`.
  - `requiredFor(GLOBAL_SET) → GLOBALS`.
- Add `AssetServiceImpl.ensureGlobalsRootFolder(projectId, ctx)`, mirroring
  `ensureMediaRootFolder`: display name "All Globals", `protected`, scope `GLOBALS`. It must
  join an open batch through `allocateOrJoin`.
- Call it from `ProjectServiceImpl.create` inside the existing creation batch, so a new
  project stays **exactly one** revision (now 8 bootstrap folders instead of 7).
- For existing projects, provision lazily wherever the other roots are (e.g.
  `FolderServiceImpl.tree` for scope `GLOBALS` / first create into the store).
- `FolderController.parseScope` accepts `GLOBALS`, and its 400 message lists it.
- Unit tests: `FolderScope.requiredFor(GLOBAL_SET)`; `UidGenerator` rejects `globals_root`;
  folder create/move across stores rejects moving a `GLOBAL_SET` into a non-`GLOBALS`
  folder (existing `AssetServiceImpl` scope check around line 514).

## Acceptance criteria

- [ ] `AssetType.GLOBAL_SET` and `FolderScope.GLOBALS` exist; `requiredFor` maps them.
- [ ] `globals_root` is reserved; a user folder or asset named "Globals Root" gets a
      different uid.
- [ ] `POST /projects` still produces exactly one revision, and its `summary.assets`
      now includes `globals_root`. Update the `M15.6.1` journey and any integration test
      that counts bootstrap folders.
- [ ] `GET /folders?scope=GLOBALS` on a project created before this change returns the
      lazily provisioned root, and provisioning is itself one revision (or joins the
      caller's batch).
- [ ] A `GLOBAL_SET` can't be created in, or moved to, a folder of another scope (400/422 as
      for other stores).
- [ ] `./gradlew :server:sf-domain:test :server:sf-api:test` green.

## Out of scope

- The `GlobalSetService` create/update logic (`M17.1.2`).
- Export/import of the new root (`M17.1.3`).
- The UI (`M17.4.1`).

## Notes / hazards

- `ProjectExportImportServiceImpl` remaps the fixed folders by uid (lines ~416–429,
  `findFixedFolderByUid(assets, FolderScope.*_ROOT_UID)`). Adding a root without adding it
  there makes an import mint a *second* `globals_root` or fail on the uid. That is
  handled in `M17.1.3`; don't ship this task on its own to a real deployment.
- Grep every `switch` on `AssetType`/`FolderScope` (`FolderServiceImpl.tree/updateStartNode`,
  `AssetServiceImpl.create/softDelete/move/changeUid`, `BuildPlanner`, `Snapshot`, UI
  `CreateAssetKind`, `tree-sort.util.ts`). A non-exhaustive `default -> null` hides a
  missing case silently rather than failing compilation.
- `asset.asset_type` is `VARCHAR(30)` with no check constraint (`002-assets.xml`), so no
  Liquibase changeset is needed.
