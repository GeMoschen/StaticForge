---
id: M21.1.1
status: todo
depends: [M16.5.2, M16.3.1]
epic: m21-pagination
feature: cdl
area: backend
---

# M21.1.1 — `pagination` CDL editor type, stored value, validation

## Context

`EditorType` (`server/sf-template/src/main/java/com/acme/staticforge/template/content/EditorType.java`)
currently has 18 types (TEXT … JSON, CATALOG), mapped from CDL keywords in
`CdlValidator` (type map, e.g. `Map.entry("catalog", EditorType.CATALOG)`) with attributes
parsed by `CdlParser` (keyword set in `CdlLexer`). Typed JSON values already exist as a pattern
(`{type:"ASSET_REF",…}` for `reference`, `{type:"CATALOG",cards:[…]}` for `catalog`), and
`ContentReferenceService.materialize` scans payloads for them to write `asset_reference` rows.
Page templates declare bodies. `$CMS_BODY` in a section template is already a validation error
(`SF-TPL-0120`), which is the precedent for "page-template-only" constructs.

## Goals

- Add `EditorType.PAGINATION` with CDL keyword `pagination`.
- Attributes (parsed in `CdlParser`, carried on `EditorDefinition`, added to the `CdlLexer`
  keyword set where needed):
  - `sources [..]`: subset of `"nav"`, `"dataset"`. Default `["nav"]`. Unknown value →
    `SF-CDL-0104`.
  - `pageSize N`: default page size, `1..1000`.
  - `maxPageSize N`: optional; must be `≥ pageSize`.
  - `sort [..]`: offered sort keys. For `nav`: `navigation` (tree order as `$CMS_NAVIGATION`
    renders it), `position` (target page `nav.position`), `date` (target page `nav.date` /
    `publishedOn`), `displayName`. For `dataset`: any top-level scalar field declared in the
    dataset schema (checked at page-save time, because the schema is not known at CDL compile
    time). The first entry is the default. Every key implies a final `uid` → `uuid` tiebreak.
- New CDL diagnostics in `DiagnosticCodes` (next free `SF-CDL-*` codes, documented in
  `docs/template-developer-guide.md` §3.2):
  - `pagination` declared in a **section** template → error.
  - More than one `pagination` editor in one page template → error.
  - `pagination` nested inside `list`/`group` items → error (it is a page-level concern).
- Stored value shape
  `{type:"PAGINATION", source:{kind:"NAV"|"DATASET", uuid}, pageSize, sort:{key, direction:"ASC"|"DESC"}}`.
  An unset value (`null`/missing) is valid and means "not paginated". The page then renders once,
  as today.
- Server-side validation in `ContentValidator` (wired on save by `M16.5.2`):
  - `source.kind` must be in `sources`.
  - `NAV` uuid must be a `FOLDER` with `scope: NAVIGATION`. `DATASET` uuid must be a `DATASET`
    asset (only once `M19.1.1` exists; until then `DATASET` is rejected with a clear
    "dataset sources require the content store" issue).
  - `pageSize` must be within `1..maxPageSize` (or `1..1000`).
  - `sort.key` must be offered.
- `ContentReferenceService.materialize` records the source as a `CONTENT_REF` edge
  (page → nav folder / dataset) with `source_path` `content.<editorName>.source`.
- `docs/editors/pagination.md` (same structure as `catalog.md`: stored value, attributes,
  example, rendering pointer to `$CMS_PAGINATION`) + index entry in `docs/editors/README.md`.
- Unit tests: CDL parse/compile of all attributes; each new diagnostic; `ContentValidator`
  accept/reject cases; reference materialization of the source edge.

## Acceptance criteria

- [ ] `editor pagination posts { sources ["nav"] pageSize 10 sort ["navigation","date"] }`
      compiles into an `EditorDefinition` with type `PAGINATION` and the declared attributes.
- [ ] Declaring it in a section template, twice in a page template, or inside a list item
      produces the new error diagnostics. The template save (`TemplateServiceImpl`) returns 422
      with them.
- [ ] Page save rejects an invalid pagination value (wrong kind, missing/wrong-type source,
      out-of-range size, unoffered sort key) with a field-addressed issue. A `null` value is accepted.
- [ ] A saved page with a nav-source pagination value shows up in the nav folder's usages
      (`GET /assets/{uuid}/usages`) as `CONTENT_REF`.
- [ ] `docs/editors/pagination.md` exists and the editor count in `docs/editors/README.md` and
      `docs/template-developer-guide.md` is updated.
- [ ] `./gradlew :server:sf-template:test :server:sf-domain:test` green.

## Out of scope

- Planning N outputs (`M21.2.1`) and the `$CMS_PAGINATION` render scope (`M21.3.1`).
- The Angular editor component (`M21.4.1`).
- Dataset field validation beyond "sort key is a declared scalar field" (the `where`
  filtering of dataset sources is `M19.3.1`'s query model; pagination only reuses it).

## Notes / hazards

- The CDL `visibleWhen` grammar and `renamedFrom` migration apply unchanged. Renaming a
  pagination editor must migrate the stored value like any other editor.
- Keep the value **self-describing** (`type:"PAGINATION"`) so `OctlRenderer`, the diff viewer
  (`JsonDiffer`) and `resolve-editor.ts` in the UI's visual diff can recognise it without the
  template.
- Do not let `sources` default to include `dataset` before `M19` lands. A template saved
  now must not start accepting an unusable source kind.
