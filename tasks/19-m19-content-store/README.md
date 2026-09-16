# M19 — Content store (datasets)

**Spec:** Extends §3 (glossary — new asset types), §5.1/§5.3 (entity model + payload strategy),
§5.4 (reference integrity), §12.3 (migration on CDL change — applied to records), §14 (CDL —
reused as a dataset schema language), §16.2/§16.5 (OCTL `$CMS_FOR` sources and scopes), §18.2
(incremental planning), §20.2 (REST API), §23/§24 (a new store in the UI), §26.5 (export/import).
Resolves the post-v1 candidate recorded in Appendix C **Q7** ("loops over pages/records need a
scoped query grammar"). Not part of the original §27 roadmap — inserted the same way `M8`–`M18`
were.

## Goal

Today the only repeatable, structured content a template can loop over is either page-owned
(`list`/`catalog` editors inside one page payload) or navigation-shaped (`$CMS_FOR(item : nav:uid)$`
over `NavTreeNode`s). There is no place for **shared structured records** — team members,
products, FAQs, locations, testimonials — that are edited once, have no page of their own, and are
rendered by many pages with filtering and sorting.

This milestone adds a **Content store** built from two new asset types (user decision
2026-09-15, see `tasks/todo.md`):

- **`DATASET`** — a developer-owned *schema* asset: a CDL `contentDefinition` (editors only, no
  bodies), compiled on save exactly like a section template's CDL. Lives in the Templates store in a
  new fixed `datasets` folder (next to `page_templates`/`section_templates`, `M13`), because the
  schema is *Dev*'s artifact, not *Elena*'s.
- **`RECORD`** — one asset per entry: `payload = {datasetRef, content{…}}`, living in a new
  foldered **Content** store (`FolderScope.CONTENT`, protected root `content_root`). Each record has
  its own UID, display name, revision history, usages, diff/restore, and can be the target of a
  `reference` editor.

Templates consume records with a new `$CMS_FOR` source:

```
$CMS_FOR(member : dataset:team, where="member.role == 'lead'", sort="name,-joined", limit=6)$
  <li>$CMS_VALUE(member.name)$ — $CMS_VALUE(member.title)$</li>
$CMS_END_FOR$
```

and single records with `$CMS_VALUE(record:jane_doe.name)$` (cross-asset value resolution from
`M16.2`) or by dereferencing a `reference` editor value (`$CMS_VALUE(author.name)$`).

## Exit criteria (epic is done when)

- [x] A developer can create a `DATASET` with a CDL schema in the Templates store; CDL errors are
      reported with the existing `SF-CDL-*` diagnostics, and a schema that declares `body` is
      rejected with a dedicated diagnostic.
- [x] An editor can create, edit, move (between Content folders), soft-delete, restore and diff
      `RECORD`s; every mutation is one revision; record content is validated server-side against the
      dataset's compiled definition (`M16.5.2` validator).
- [x] Renaming an editor in a dataset schema with `renamedFrom` migrates **every** record of that
      dataset inside **one compound revision** (`M15` batch), mirroring
      `TemplateServiceImpl.migrateRenames` for pages.
- [x] `$CMS_FOR(x : dataset:uid, where=…, sort=…, limit=…, offset=…, folder=…)$` renders in both
      generation and preview with identical output; invalid query arguments are compile-time
      diagnostics at template save, not render-time surprises.
- [x] `$CMS_VALUE(record:uid.field)$` and dereferenced `reference` values to records render in
      generation and preview.
- [x] Incremental generation rebuilds exactly the pages that depend on a changed record — via a
      direct reference to the record, or via a template that loops the record's dataset — proven by
      a `BuildPlanner` test, not by inspection.
- [x] Records and datasets participate in selective export/import (`M10`/`M11`/`M14`) with
      implicit-provenance handling for a record's dataset, and in usages/diff.
- [x] The Content store UI offers a folder tree, a per-dataset record grid (server-side paging,
      sorting, filtering) and a record editor built on `sf-content-form`, read-only in time travel.
- [x] A 5,000-record dataset looped by 500 pages generates within the §18.6/§26.1 budget (no
      per-page full scan of the snapshot).
- [x] `./gradlew build` and `ui` `npm run build` green; new golden-file cases green.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [domain](01-domain/README.md) | backend | `M16.3.1`, `M16.5.2` |
| 2 | [api](02-api/README.md) | backend | 1, `M19.3.1` |
| 3 | [query-octl](03-query-octl/README.md) | backend | `M19.3.1`: — ; `M19.3.2`: 1, `M16.2.2`, `M16.3.2` |
| 4 | [ui](04-ui/README.md) | frontend | 2 |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 3, 4 |

## Dependencies

`M16` (hard): cross-asset value resolution (`M16.2`), reference rows written/closed on save and
revision-aware reference queries (`M16.3`), server-side content validation (`M16.5.2`), compile
cache (`M16.1`). `M15` (compound revisions — schema-rename migration). `M13` (template store fixed
folders — the new `datasets` folder). `M10`/`M11`/`M14` (export/import). `M8` (the most recent
precedent for adding a store end-to-end). `M17` is **not** a hard dependency, but see Notes.

## Notes

- **Precedent: navigation (`M8`).** `M8` touched, in order: `AssetType` + `FolderScope` + root
  provisioning (`ProjectServiceImpl`) + export/import → a resolution service → an OCTL instruction
  + `BlockResolver` hooks implemented twice (`GenerationRenderer`, `PageRenderService`) → a REST
  controller → a UI feature folder + nav-rail entry + regenerated `schema.d.ts`. This epic follows
  the same layer order. The `assetTypeForRef` helper is duplicated in `GenerationRenderer`,
  `PageRenderService` and `TemplateServiceImpl.referenceResolver` — add the `dataset`/`record`
  prefixes in all three (or dedupe them first if `M17.3.1` already did).
- **Relationship to `M17` (Globals).** A `GLOBAL_SET` is a CDL schema *and* its values in one asset;
  a `DATASET` is a CDL schema whose values live in N `RECORD` assets. If `M17.1.2` extracted a
  shared "CDL-backed asset" helper (compile-on-save, validate, materialize references), reuse it
  rather than writing a third copy next to `TemplateServiceImpl`. Check before starting `M19.1.2`.
- **Why `template_asset_id` for `datasetRef`.** `asset_version.template_asset_id` is a real,
  indexed column already kept in sync by the domain layer for pages. Reusing it for
  record → dataset gives "all records of dataset X at revision N" as a column query (preview,
  listing, planner) instead of a JSON scan. `M19.1.1` decides and documents this; the payload keeps
  `datasetRef` as the source of truth, like `templateRef` for pages.
- **Where-grammar.** `where=` uses the **OCTL expression grammar** (`octl/Expr`, §16.9 — the one
  `$CMS_IF` uses), not the CDL `visibleWhen` grammar (`expression/ExpressionEvaluator`), which is
  deliberately tiny and shared with the Angular form engine through one fixture file. Do not extend
  the `visibleWhen` grammar or its fixture for this epic. The record grid's filter is evaluated
  server-side, so no TypeScript port of the query evaluator is needed.
- **Dependency granularity.** Originally accepted as a v1 trade-off (any record change rebuilds every
  page looping the dataset); implemented after the epic landed: the planner rebuilds a looping page
  only if the loop's `folder`/`where` may select the changed record before or after the change (see
  the `M19.3.2` notes). `M22` build insight should show the reason as "record X of dataset team
  changed".
- **Not in scope:** localizable record values (`M24.3.3`), paginating over a dataset (`M21` —
  consumes `M19.3.1`'s query model), search indexing of records (`M23.1.2`), relations with
  referential actions (cascade delete), computed fields, a record import from CSV.
- Spec follow-up (later doc task, as with `M8`–`M15`): §3 glossary, §5.1 diagram, §16.2 table, and
  Appendix C Q7 status once this epic lands.
