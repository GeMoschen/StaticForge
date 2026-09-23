---
id: M25.2.1
status: done
depends: [M25.1.1]
epic: m25-record-sets
feature: rendering
area: backend
---

# M25.2.1 — Per-channel record templates on `DATASET`

## Context

Section templates store OCTL per channel under `payload.channelTemplates.<channel>` and compile on save
(`TemplateServiceImpl`, compile cache `M16.1`, reference rows with source path
`channelTemplates.<channel>` `M16.3.2`). A `DATASET` today is CDL only (`SF-CDL-0108` rejects `bodies`).
Epic decision 4 is binding.

## Goals

- `DATASET` payload gains optional `channelTemplates.<channelKey>` (OCTL source). `CreateDatasetCommand` /
  `UpdateDatasetCommand` carry them; unknown channel keys are rejected like on section templates.
- Compile on save with the dataset's own definition as the local scope: record fields are top-level
  names (`$CMS_VALUE(name)$`), plus `_uid`, `_uuid`, `_displayName`, `_recordSet`, and the per-render loop
  meta `_index`, `_first`, `_last`, `_count`. Unknown names are the usual unknown-editor diagnostic;
  `SF-TPL-0310` (declared but unused) is **not** raised for datasets. `$CMS_EXTENDS$`, `$CMS_BODY$` and
  `$CMS_BLOCK$` are errors in a record template (new `SF-TPL-*` code).
- Write template OCTL reference rows for record templates exactly like section templates (so usages and
  the planner see `$CMS_REF`/`$CMS_VALUE(page:…)$` inside them).
- Compiled record templates go through the existing compile cache, keyed like section templates.
- `renamedFrom` on the dataset schema rewrites field names in its own record templates in the same
  revision **only if** section templates get the same treatment today; otherwise the save reports them as
  diagnostics like a section template would — check `TemplateServiceImpl.migrateRenames` and mirror it.

## Acceptance criteria

- [x] Create/update a dataset with an `html` and `md` record template; a template reading an undeclared
      field is rejected with a diagnostic pointing at line/column; `$CMS_BODY(x)$` is rejected.
- [x] Reference rows for a record template's `$CMS_REF(page:home)$` appear under `channelTemplates.html`
      and show up in `page:home`'s usages.
- [x] Datasets without record templates keep saving and rendering exactly as in `M19` (regression).

## Out of scope

- Rendering a set through the template (`M25.2.2`); the editor UI (`M25.5.2`).

## Notes / hazards

- Keep the "schema is CDL, no bodies" rule (`SF-CDL-0108`): record templates are *OCTL next to the CDL*,
  not CDL `bodies`.

## Implementation notes (2026-09-23)

- **Payload.** `DATASET.payload.channelTemplates.<channel> = {source, compiledHash}` — the section template shape.
  Written only when the dataset has at least one record template, so a dataset without any keeps the exact M19
  payload (no empty object). Blank sources are dropped (= no template for that channel). Read helper:
  `asset.dataset.RecordTemplates` (`PAYLOAD_FIELD`, `source(payload, channel)` → `Optional`, `sources(payload)`).
- **Commands.** `CreateDatasetCommand` / `UpdateDatasetCommand` gained `Map<String, String> channelTemplates`; the old
  constructors stay as secondary constructors (no templates / keep stored). Update semantics: `null` keeps the stored
  record templates and recompiles them against the new schema (a pre-`M25.5.2` UI sends none); a map replaces all of
  them (an empty map removes every template).
- **Compile profile — `OctlCompiler.compileRecordTemplate(source, channel, resolver, datasetDefinition)`**
  (sf-template). Scope: the dataset's editors as top-level names, `RecordView.META_FIELDS` (`_uuid`, `_uid`,
  `_displayName`, `_folderPath`, `_recordSet`, `_changedAt`), `_meta`, and `OctlCompiler.RECORD_POSITION_FIELDS`
  (`_index`, `_first`, `_last`, `_count`); any other bare name is `SF-TPL-0103`. `CMS_PAGE`, `CMS_GLOBAL`,
  `$CMS_INCLUDE`, loops, dataset loops and cross-asset values work as in a section template. `SF-TPL-0310` is not
  raised. **New code `SF-TPL-0122`** (`DiagnosticCodes.OCTL_NOT_ALLOWED_IN_RECORD_TEMPLATE`): `$CMS_EXTENDS`,
  `$CMS_BLOCK`, `$CMS_PARENT` and `$CMS_BODY` anywhere in the source, each at its line/column. The inheritance rules
  (`SF-TPL-015x`) don't run for a record template, so those four yield only `0122`; names inside a rejected block are
  still checked. (`$CMS_PARENT` is included because without the inheritance rules nothing else would reject it.)
- **Save (`DatasetServiceImpl`).** Record templates compile after the CDL, against the schema being saved, before
  any revision is allocated. An unknown channel key (not an `OutputChannel` of the project) is `422 SF-API-0422` with
  `field: channelTemplates.<key>`. Compile errors are `422 SF-API-0422` with `channel` (first failing channel in key
  order), `diagnostics` (that channel's) and `channelDiagnostics` (every failing channel → its diagnostics). Warnings
  come back on the create/update response as `DatasetView.recordTemplateDiagnostics` (`Map<channel,
  List<Diagnostic>>`, empty on reads). The save-time resolver answers `datasetDefinition(self)` with the schema being
  saved, so a record template looping its own dataset is field-checked against the new fields.
- **Deviation — "unknown channel keys are rejected like on section templates".** Section templates don't reject
  unknown channel keys today (nothing validates `channelSources` keys). The goal is kept for datasets (checked against
  the project's `OutputChannel`s, `422` with `field`); section templates are unchanged.
- **Rename rule (checked `TemplateServiceImpl.migrateRenames`).** Section templates' OCTL is *not* rewritten on
  `renamedFrom` (only page content is), and their channels compile against the new CDL in the same save. Mirrored:
  record template sources are never rewritten; a template still reading the old name fails the dataset save with
  `SF-TPL-0103` at its line/column (also when the request omits `channelTemplates` — the stored ones are recompiled),
  nothing is written, and the developer saves the schema and the fixed template together.
- **Reference rows.** `ReferenceMaterializer.extract` handles `DATASET` like `SECTION_TEMPLATE`
  (`templateReferences`): one `OCTL_VALUE`/`OCTL_REF`/`OCTL_INCLUDE` row per resolved reference and use, source path
  `channelTemplates.<channel>`; usages, usages-at-revision and reference integrity see them with no further change.
- **How `M25.2.2` obtains "the compiled record template of dataset D for channel C"** (never compile per record):
  - Source: `RecordTemplates.source(datasetPayload, channel)`; empty → no record template (the missing-template
    warning). The CDL is `datasetPayload.contentDefinition`.
  - **Generation (snapshot):** the renderer's build memo (`compiledTemplateCache.buildMemo(snapshot)`, already held by
    `GenerationRenderer` as `compiledTemplates`):
    `memo.compileRecordTemplate(datasetUuid, channel, cdl, source, snapshotResolver)` — compiled once per (dataset,
    channel) per build and shared by every record of every set; the schema is the same instance as
    `memo.definition(datasetUuid, cdl)`.
  - **Preview:** `compiledTemplateCache.compileRecordTemplate(projectId, datasetUuid, datasetVersion.validFromRevision(),
    channel, cdl, source, referenceResolver(projectId))` with the dataset version valid at the preview revision
    (`assetService.findAt` for time travel) — keyed `(projectId, datasetUuid, validFromRevision, channel)` in the same
    cache as section templates and re-validated against references on every hit.
  - Both return a `CompiledChannel` (`template()`, `definition()`) and count in `sf.template.compiles{kind}`. The
    payload's `compiledHash` equals `CompiledChannel.template().hash()` for the stored source.
- **Channel and uid scans include datasets.** `ChannelServiceImpl.CHANNEL_TEMPLATE_HOLDERS`: deleting a channel is
  blocked (`409 SF-CH-0201`, `previewDelete`) by a dataset record template for it; creating a channel with `copyFrom`
  seeds datasets' record templates too. `AssetServiceImpl`'s uid-literal scan (uid change) lists datasets whose record
  templates contain `assetType:oldUid`. Search already indexed datasets' `channelTemplates.*.source`
  (`TemplateTextExtractor`; Javadoc updated).
- **REST (minimal; the rest is `M25.3.1`).** `CreateDatasetRequest` / `UpdateDatasetRequest` gained
  `channelTemplates` (channel → source); `DatasetDetailView` gained `channelTemplates` (JsonNode) and
  `recordTemplateDiagnostics`. **OpenAPI and `ui/src/app/core/api/generated/schema.d.ts` were not regenerated** (left to
  `M25.3.1`); the current UI keeps working because an update without `channelTemplates` keeps them.
  `brokenRecordSets` is still not in the DTO (`M25.3.1`). `docs/api.md` dataset rows and the template developer
  guide's code table (`SF-TPL-0122`, `0310` note) updated.
- **Left for later tasks.** `M25.2.2`: rendering and binding the loop meta names at render time. `M25.2.3`: a change
  of a dataset's `channelTemplates` (vs. its schema) needs its own plan reason; `DatasetLoopImpact` doesn't scan
  dataset record templates for `dataset:` loops inside them yet. `M25.4.1`: `channelTemplates` travel in the payload
  unchanged. A generic restore of an older dataset version writes its payload as is (same as templates).
- **Tests.** `OctlCompilerRecordTemplateTest` (sf-template, 11: scope names, unknown field position, no `0310`, the
  section-template contrast, `0122` for body/extends/block/parent incl. nested position, references, dataset loop,
  null definition); `CompiledTemplateCacheTest` (+3: cross-request key and record scope, reference re-validation,
  build memo once per build); `ReferenceMaterializerTest.derivesOctlEdgesPerChannelFromADatasetsRecordTemplates`;
  `DatasetRecordTemplateIntegrationTest` (sf-app, 11: html+md create/read/replace; undeclared field → 422 with
  channel, line/column, no revision; `0122` for body/extends/block; unknown channel; per-channel warnings; reference
  rows under `channelTemplates.html`/`.md` in `page:home`'s usages, closed on removal, still there at the old
  revision, uid-literal scan; M19 payload shape kept and update-without-templates keeps them; rename rule;
  own-dataset loop checked against the saved schema; compile cache hit + `compiledHash`; channel delete blocked /
  copy seeds); `DatasetApiTest.recordTemplatesRoundTripWithPerChannelDiagnostics` (REST shapes). M19 regression:
  `DatasetRecordIntegrationTest`, `M19ContentStoreJourneyIntegrationTest` and the dataset golden files unchanged and
  green.
