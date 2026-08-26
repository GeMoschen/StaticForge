---
id: M8.1.1
status: todo
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

- [ ] `./gradlew build` is green with zero references to `structure`/`Structure`/`NAV`
      (nav-specific) symbols outside git history.
- [ ] `ng build` is green; the `/structures` route 404s (removed, not redirected).
- [ ] Liquibase changelog for the `structure` asset-type removal is written and the
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
