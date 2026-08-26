---
id: M8.1.1
status: done
depends: []
epic: m8-navigation-rewrite
feature: navigation-store
area: fullstack
---

# M8.1.1 — Remove the legacy `structure` feature

## Context

M8 replaces `structure` (§17, implemented in `M5.3.*`) wholesale rather than evolving
it — `kind: breadcrumb | list`, the hand-rolled source DSL, and reuse of `$CMS_NAV` are
all dropped. Land the removal as its own task so the domain rewrite (`M8.1.2`) starts on
a clean tree instead of a diff against dead code.

## Goals

- Delete backend: `server/sf-domain/.../structure/*` (`ExpandMode`, `NavNode`,
  `OrderClause`, `RootKind`, `StructureKind`, `StructureRoot`, `StructureService(Impl)`,
  `StructureSource`, `StructureSourceParser`, `StructureView`).
- Delete `server/sf-generate/.../generate/nav/*` (`NavigationBuilder`, `NavRenderer`).
- Delete `server/sf-api/.../StructureController.java` and
  `dto/Structure{CreateRequest,Detail,PreviewRequest,Summary,UpdateRequest}.java`.
- Delete `ui/src/app/features/structures/*` and its route registration in
  `app.routes.ts`, and remove its entry from the dashboard nav rail.
- Remove `STRUCTURE` from `AssetType` and add a Liquibase changelog that migrates any
  existing `structure`-typed asset rows: either hard-delete them (dev/demo data only —
  confirm no production migration path is expected) or leave a documented manual
  export step if project data must be preserved. Record the decision made.
- Remove `renderNav`/`renderNavRecurse` from `BlockResolver` and their call sites in
  `GenerationRenderer` and preview's `PageRenderService` (the replacement instruction
  is added fresh in `M8.1.4`, not by keeping these methods).
- Remove `GenerationDiagnosticCodes.GEN_NAV_CYCLE` / `SF-GEN-0410` (re-added under a new
  code in `M8.1.3` if still needed for the new resolver's cycle protection).

## Acceptance criteria

- [x] `./gradlew build` is green with zero references to `structure`/`Structure`/`NAV`
      (nav-specific) symbols outside git history.
- [x] `ng build` is green; the `/structures` route 404s (removed, not redirected).
- [x] Liquibase changelog for the `structure` asset-type removal is written and the
      decision (hard-delete vs. documented export) is recorded in this file's Notes.

## Out of scope

- The new navigation domain model and any replacement rendering (`M8.1.2`–`M8.1.4`).

## Notes / hazards

- `BlockResolver` is a shared interface used by both generation and preview — removing
  two of its methods is a breaking change for both call sites; grep both before
  deleting.
- Double-check `OutputChannel`/`ChannelService` and the OCTL grammar/lexer do not encode
  `structure:` as a reference kind anywhere outside the files listed above (e.g.
  `UrlResolver`'s `kind` dispatch, `AssetType` used in OCTL's `assetRef` grammar) —
  those need the `structure` case removed too.

### Resolution notes (M8.1.1 implementation)

- **Liquibase decision: hard-delete.** Added
  `server/sf-app/src/main/resources/db/changelog/v1.0/013-remove-structure-assets.xml`
  (next free changelog number after `012-project-media-settings.xml`). It deletes, in FK
  order, `asset_uid_history` → `asset_reference` (both `from_asset_id` and `to_asset_id`)
  → `asset_version` → `asset` rows for `asset_type = 'STRUCTURE'`. Confirmed with the repo
  owner's instruction that this is dev/demo data only with no production migration path,
  so a documented manual export step was not needed.
- **`$CMS_NAV`/`$CMS_NAV_RECURSE` OCTL grammar was in scope too, beyond the file list in
  the task Goals.** The spec context ("reuse of `$CMS_NAV` ... dropped") and the
  acceptance criterion's explicit "zero ... `NAV` (nav-specific) symbols" meant removing
  more than just `BlockResolver.renderNav`/`renderNavRecurse`:
  - `OctlNode.Nav` / `OctlNode.NavRecurse` AST records (`sf-template/.../octl/OctlNode.java`).
  - The `"NAV"` / `"NAV_RECURSE"` instruction cases in `OctlParser.java`.
  - The `OctlNode.Nav` / `OctlNode.NavRecurse` cases in `OctlCompiler.java`'s validation walk.
  - The `renderNav`/`renderNavRecurse` dispatch methods in `OctlRenderer.java`.
  - The now-dead `ReferenceKind.NAV` enum constant (`sf-domain/.../asset/ReferenceKind.java`)
    — never referenced by any production code once the OCTL Nav node was gone.
  - `RendererTest.java`'s `navRecurseDelegatesResolvedLoopItemToBlockResolver` test and the
    `renderNav` overrides in its other `BlockResolver` anonymous classes.
  M8.1.4 will introduce a fresh instruction/AST node for the new navigation resolver rather
  than reusing any of this.
- Found and fixed additional `structure`/`STRUCTURE` references not in the task's file
  list:
  - `AssetServiceImpl.findUidLiteralReferences` had `structure` in its literal-reference
    regex and scanned `AssetType.STRUCTURE` templates for `structure:uid` literals.
  - `ProjectExportImportServiceImpl.NON_FOLDER_ORDER` included `"STRUCTURE"` in the
    asset-type import ordering list.
  - `ProjectExportImportIntegrationTest` created a `StructureView` via `StructureService`
    and asserted on it round-tripping through export/import; updated to drop the
    structure asset and adjusted the expected `importedAssetCount()` from 5 to 4.
  - `RenderPipeline`/`GenerationRenderer` constructor wiring for `NavRenderer` (Spring
    autowires `RenderPipeline`, so no other caller needed updating).
  - Frontend: `app.routes.ts` route + import, `nav-rail.component.ts` nav item,
    `reference-editor.component.ts`'s per-type link map, and
    `sf-asset-picker-dialog.component.ts`'s `PickerType`/`TYPE_OPTIONS` all had a
    `STRUCTURE`/`Structures` case.
  - `ui/src/app/core/api/generated/schema.d.ts` is generated from the backend's OpenAPI
    document (`./gradlew :server:sf-app:generateOpenApi` + `npm run generate:api` in
    `ui/`); regenerated so it no longer references `Structure*` schemas/paths.
- `UrlResolver`'s `kind` dispatch never had a `"structure"` case (only `page`/`media`/
  `folder`), so no change was needed there. OCTL's `Accessor.assetType()` is a free-form
  string (not validated against an enum at the grammar level), so no asset-ref "kind"
  switch needed a `structure` case removed either — the only literal `"structure"` string
  in the OCTL/reference-resolution path was the regex in `AssetServiceImpl` noted above.
- Verified with a `./gradlew clean build` (full test suite, all modules) and a standalone
  `cd ui && npm run build` — both green. Also ran `./gradlew :server:sf-app:generateOpenApi`
  to regenerate `openapi.json` (used to confirm/regen the frontend's `schema.d.ts`).
