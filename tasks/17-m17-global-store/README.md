# M17 — Global store (project property sets)

**Spec:** Extends §3 (glossary: new asset type), §5.1 (entity relationships), §10.2/§17
(stores and folders, following the `NAVIGATION` store added in `M8`), §14 (CDL, reused
unchanged as the schema language of a property set), §16.2/§16.5 (OCTL: new `global:`
reference prefix and `CMS_GLOBAL` accessor root), §18.1 (incremental generation), §20.2
(REST API), §23/§24 (a new store in the UI). Not part of the original §27 roadmap; it's
inserted after the `M16` foundations epic, the same way `M8`–`M15` were.

## Goal

Today nothing site-wide can be edited as content. The site title, social links, the
footer copyright line, a contact address and the brand logo are either hardcoded into
channel templates (so every change needs a template developer) or copied into every
page's editors. `Project` (`server/sf-domain/.../project/Project.java`) only has `key`,
`name`, `description`, `archived` and `allowedMimeTypes`, with no settings JSON.
`OutputChannel.settings` is JSON but per channel and not editor-facing, and
`ExportedSettings(channels, targets)` carries no project-level values.

This milestone adds a **Globals store** holding **named property sets**: `GLOBAL_SET`
assets such as `site`, `social` and `footer`. Each set:

- has its fields declared in CDL by a template developer (the same language, compiler
  `CdlCompiler` and editor types as templates),
- has its values filled in by editors through the same dynamic form engine
  (`sf-content-form` + `FormBuilderService`) the page editor uses,
- is a normal revisioned asset: spine, history, diff, restore, usages, time travel,
  export/import,
- is readable from any channel template as `$CMS_VALUE(global:site.title)$`, or through
  the shorthand accessor root `CMS_GLOBAL`, e.g. `$CMS_VALUE(CMS_GLOBAL.site.title)$` or
  `$CMS_IF(CMS_GLOBAL.site.showBanner)$`,
- makes an incremental generation rebuild exactly the pages whose render read it when
  its values change.

## Exit criteria (epic is done when)

- [ ] A developer can create a property set `site` in the Globals store, declare
      `editor text title`, `editor media logo` and `editor boolean showBanner` in its
      CDL, and save it. CDL errors are reported with `SF-CDL-*` diagnostics exactly as
      for templates.
- [ ] An editor (role `EDITOR`) can fill in and save the values of `site`, but cannot
      change its schema (403). Each save is exactly one revision touching exactly one
      asset.
- [ ] `$CMS_VALUE(global:site.title)$`, `$CMS_VALUE(CMS_GLOBAL.site.title)$`,
      `$CMS_REF(CMS_GLOBAL.site.logo)$` and `$CMS_IF(CMS_GLOBAL.site.showBanner)$` render
      the set's current values in preview and at the snapshot revision in generation.
      A template that references an unknown set fails to save with `SF-TPL-0110`.
- [ ] After changing `site.title`, an `INCREMENTAL` generation re-renders every page that
      read `site` and no page that didn't (verified by the plan entries).
- [ ] Renaming an editor in a set's CDL with `renamedFrom` keeps its value, in the same
      single revision as the schema change.
- [ ] A set referenced by a template or rendered page can't be deleted, and its usages
      list those referrers.
- [ ] A Globals store (whole store, a folder, or single sets) round-trips through selective
      export/import with schema and values intact.
- [ ] The Globals UI (nav rail entry, tree, values form, schema editor) is fully
      read-only while time travel is active (`M15.5` backstop plus visibly disabled controls).
- [ ] `./gradlew build` and `ui` `npm run build` are green. New UI component specs are
      written; their execution is subject to the known `templateUrl` spec-runner issue
      (see `M15` exit criteria).

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [domain](01-domain/README.md) | backend | `M16` (reference materialization, content validation) |
| 2 | [api](02-api/README.md) | backend | 1 |
| 3 | [octl](03-octl/README.md) | backend | 1, `M16.2` (cross-asset values) |
| 4 | [ui](04-ui/README.md) | frontend | 2 |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 3, 4 |

## Dependencies

- `M16.2` (cross-asset values): `global:site.title` is exactly the cross-asset
  `$CMS_VALUE(type:uid.path)$` form that `OctlRenderer.resolve` renders as `MissingNode`
  today ("deferred"). This epic doesn't implement a second, globals-only resolution path;
  it plugs `GLOBAL_SET` into the `M16.2` resolver.
- `M16.3` (reference materialization on save plus revision-aware queries): usages,
  delete protection and incremental rebuilds on globals are only correct once references
  are written at save time and closed when they go away.
- `M16.5.2` (server-side `ContentValidator`): set values are validated with the same
  mechanism as page content, not a globals-specific validator.
- `M16.1` (compile cache): a set's CDL is compiled once per revision, not once per render.
- `M8` (navigation store): the precedent for adding a store end to end (domain, root
  folder provisioning, controller, UI feature, export/import).
- `M13` (template store folders) and `M15` (compound revisions): root provisioning joins
  the project-creation batch, and schema-change migration is one revision.

## Notes

- **Asset type, not a project column.** Using a project column or a channel-settings
  blob would lose revisions, diff, restore, usages and export for free. `GLOBAL_SET` is a
  regular `AssetType`, stored in `asset`/`asset_version` like everything else. No new
  table and no Liquibase change are expected (`asset.asset_type` is `VARCHAR(30)` with no
  check constraint).
- **One asset holds both schema and values.** The payload is
  `{contentDefinition, compiledDefinition, content}`. That means a schema change and the
  value migration it causes are the same asset in the same revision, with no cross-asset
  cascade like `TemplateServiceImpl`'s page migration. Separate permissions (schema =
  `DEVELOPER`, values = `EDITOR`) are enforced per endpoint, not by splitting the asset.
- **`$CMS_GLOBAL.site.title$` vs `CMS_GLOBAL` accessor root.** The roadmap decision
  wrote the shorthand as `$CMS_GLOBAL.site.title$`. In the real code, `CMS_PAGE` is not a
  standalone instruction. It's an *accessor root* that `OctlRenderer.resolve` recognizes
  inside `$CMS_VALUE(…)$`, `$CMS_IF(…)$`, `$CMS_FOR(…)$` and so on (the `OctlParser`
  switch has no `PAGE` instruction). `CMS_GLOBAL` follows the same pattern, e.g.
  `$CMS_VALUE(CMS_GLOBAL.site.title)$`, for consistency. A bare `$CMS_GLOBAL.x$`
  instruction form is **not** added, because it would be the only instruction of that shape.
- **Namespace is flat by uid.** Sets may be organized into folders in the Globals store,
  but `global:<uid>` addresses a set by uid, which is unique per `(project, asset_type)`.
  Moving a set between folders never breaks templates.
- Localization of global values (locale-dependent editors inside a set) is `M24.3.3`
  and is not planned here.
