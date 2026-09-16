# StaticForge CMS — Architecture

This document grounds the high-level architecture described in `cms-specification.md` §4–§7 in the code as it actually exists. It is a *reader's* map, not a spec: where a class or module is named, it exists in the repository.

The signed-off architecture decisions live in [`docs/adrs/`](adrs/):

- [0001 — Module layering](adrs/0001-module-layering.md)
- [0002 — Revision safety](adrs/0002-revision-safety.md)
- [0003 — JSON payload + reference materialization](adrs/0003-json-payload-reference-materialization.md)
- [0004 — CDL + OCTL languages](adrs/0004-cdl-octl-languages.md)
- [0005 — Generation atomic publish](adrs/0005-generation-atomic-publish.md)

## 1. System overview

StaticForge is a **headless, revision-safe CMS that produces static sites**. Three concerns are deliberately separated (§1):

| Concern | Owned by | Artifact |
|---|---|---|
| *What can be edited* | CDL inside templates | editor declarations |
| *What the editor typed* | content storage | versioned content values per asset |
| *How it is rendered* | OCTL channel templates | one template per (template, channel) pair |

```
Browser (Angular SPA)
   │  HTTPS · REST/JSON · Bearer JWT
Spring Boot backend (staticforge-server)
   │  JDBC                        │ file/S3
PostgreSQL (external Docker)      Binary store (media + generated output)
```

Runtime is Java 21 / Spring Boot 3.3 with virtual threads enabled for generation fan-out. See spec §4.2 for the full technology table.

## 2. Module layout

Six Gradle modules, dependency edges strictly upward (see ADR-0001):

```
sf-app → sf-api → { sf-domain, sf-template, sf-generate } → sf-common
                       sf-domain → sf-template
```

| Module | Package roots (`com.acme.staticforge.*`) | Responsibility |
|---|---|---|
| `sf-common` | `common` | `Problem`/`ProblemFactory` (RFC 9457), `JsonUtil`, shared utilities |
| `sf-domain` | `asset` (incl. `asset.globals`), `revision`, `project`, `user`, `channel`, `structure`, `preview`, `generate` | entities, repositories, domain services, transactions |
| `sf-template` | `template.cdl`, `.octl`, `.render`, `.content`, `.diagnostic`, `.expression` | CDL + OCTL lex/parse/compile/render |
| `sf-generate` | `generate.plan`, `.snapshot`, `.render`, `.stage`, `.target`, `.nav`, `.postprocess` | build planning, rendering pipeline, writers, targets |
| `sf-api` | `api`, `security` | REST controllers, DTOs, JWT/authorization |
| `sf-app` | root, `tooling` | Spring Boot application, Liquibase, `OpenApiGeneratorMain` |

The `checkModuleLayers` task (root `build.gradle.kts`) fails the build on any forbidden edge.

## 3. Core domain model

The model strictly separates **identity** from **state** (ADR-0002):

- `Asset` — one immutable row per asset for its lifetime; holds `uuid`, `project_id`, `asset_type`, `uid`, `created_at/by`. Updated only on an explicit UID rename.
- `AssetVersion` — one row per change; holds the mutable state (`display_name`, `folder_id`, `folder_path`, `template_asset_id`, payload) plus a `valid_from_revision`/`valid_to_revision` interval and a `deleted` flag.
- `AssetReference` — materialized outgoing edge (`from_asset_id`, `to_asset_id`, `kind`, `source_path`, revision interval), typed by `ReferenceKind` (ADR-0003).

Type-specific data lives in a `jsonb` payload column (ADR-0003); the handful of query/integrity fields are real columns on `asset_version`, kept in sync by the domain layer. `asset_reference` powers the usage view, the delete guard, incremental generation, and broken-link reporting.

Reference edges are written on save (spec §5.4), in package `asset.reference`:

- `ReferenceMaterializer` (`@RevisionAware`) — called by every version writer (`AssetServiceImpl`, `FolderServiceImpl`, `TemplateServiceImpl`, `ChannelServiceImpl.seedFrom`, `ProjectExportImportServiceImpl`, `ProjectRestoreService`) in the same transaction and revision. `extract(projectId, type, payload)` derives the edge set (`TEMPLATE`, `MEDIA_REF`/`CONTENT_REF` via `ContentReferenceService.extract`, `NAV`, and `OCTL_*` by compiling template channel sources); the write is a per-edge diff against the open rows. `ReferenceMaterializationGuardTest` (ArchUnit) fails if a class saves asset or media versions without depending on it.
- `ProjectReferenceResolver` — the project-scoped OCTL `ReferenceResolver` (including the `nav:` alias and its navigation-scope check), shared by compile-on-save validation and edge extraction, so a reference that saves is exactly one that is persisted.
- `ReferenceBackfill` + `bootstrap.ReferenceBackfillRunner` (`sf-app`) — rebuild all rows from `asset_version` at startup when the table is empty (`sf.references.backfill-on-startup`).
- Readers use `AssetReferenceRepository`'s revision-aware queries: `findIncomingOpen` (delete guard, usages), `findIncomingValidAt` (usages at `?revision=`), `findValidAtByProject` (the `BuildPlanner` reverse index).

Page content validation (spec §10.5): `asset.content.ContentValidator` and `PageContentValidator` are pure and return `ContentIssue`s with a `STRUCTURAL` or `COMPLETENESS` kind. `asset.page.PageContentValidation` rejects structural findings on save (`422` with `issues`) and fills `PageView.issues`; `RenderPipeline.incompletePages` holds back incomplete pages at publish (`SF-GEN-0120`).

Stores and asset types: `AssetType` is `PAGE`, `MEDIA`, `SECTION_TEMPLATE`, `PAGE_TEMPLATE`, `FOLDER`, `PAGE_REFERENCE`, `GLOBAL_SET`, `DATASET` and `RECORD`. Each leaf type lives in exactly one store, a folder hierarchy of its own (`FolderScope` `PAGES`, `MEDIA`, `NAVIGATION`, `TEMPLATES`, `GLOBALS`, `CONTENT`, mapped by `FolderScope.requiredFor`), under a fixed, protected root folder (`pages_root`, `media_root`, `navigation_root`, `templates_root`, `globals_root`, `content_root`) that project creation provisions inside its single revision and older projects get lazily.

Global property sets (M17), package `asset.globals`: a `GLOBAL_SET` holds its CDL schema *and* its values in one payload (`{contentDefinition, compiledDefinition, content}`), so a schema change and the value migration it causes (`asset.content.ContentRenameMigrator`, shared with the section-template cascade) are one version write. `GlobalSetServiceImpl` adds only what is set-specific — compile with `template.cdl.GlobalSetCdlRules` (no `body`, no `catalog`: `SF-CDL-0107`), seed, migrate, validate with `ContentValidator` — and writes through `AssetService`, so concurrency, scope checks, revisions and reference edges are the generic ones. Templates read a set through the ordinary cross-asset path: `global:` is registered in `AssetReferencePrefixes`, `AssetValueProjection` exposes a set's `content`, and `CMS_GLOBAL.<set>.<path>` is desugared by the OCTL parser (`Accessor.scope`) into `global:<set>.<path>`, so there is no globals-specific resolver.

Datasets and records (M19), package `asset.dataset`: a `DATASET` is a record schema (`{contentDefinition, compiledDefinition, titleEditor, description}`) in the fixed `datasets` folder of the Templates store; a `RECORD` is `{datasetRef, content}` in the Content store, with `datasetRef` mirrored into `asset_version.template_asset_id` so a dataset's records are one indexed query (`AssetVersionRepository.findCurrentRecordsOfDataset`, `searchCurrentRecordsOfDataset`, `findRecordsOfDatasetAt`). `DatasetServiceImpl` compiles with `template.cdl.DatasetCdlRules` (no `body`: `SF-CDL-0108`); a `renamedFrom` rename runs `RecordRenameMigration` inside the schema's batch, rewriting records in flushed chunks with one revision summary, so the rename is one revision at any dataset size. `RecordServiceImpl` validates with `ContentValidator` plus `RecordDatasetLookup` (a `reference` with `dataset "uid"` must point into that dataset — a structural `dataset` finding) and lists records by narrowing in SQL (`q`, folder) and then applying the pure query model. That model lives in `sf-template` (`template.query`: `DatasetQuery`, `DatasetQueryParser`, `DatasetQueryEvaluator`, `RecordView`), so the REST listing, preview and generation share one set of semantics; `where` is parsed by `octl.OctlExpressions`. The compiler parses a loop's arguments once into the `CompiledTemplate` (`SF-TPL-0140`) and, at save, checks fields against the schema through `ReferenceResolver.datasetDefinition` (`SF-TPL-0141`/`0142`). Records reach the renderer through `AssetValueResolver.datasetRecords` — `LiveAssetValueResolver` in preview (at the requested revision), `SnapshotAssetValueResolver` in generation (an index built once per snapshot) — and a `reference` to a record is dereferenced in `OctlRenderer.resolveSub`. Dependencies: a loop is an `OCTL_*` edge to the dataset, a record's `datasetRef` a `TEMPLATE` edge; walking back from a dataset skips its own records, and every record the `BuildPlanner` walk visits (changed, or reached through a reference) continues only to the templates with a loop that may select it before or after the change (`plan.DatasetLoopImpact`: loops found by uid in a resolver-less compile, `DatasetQueryEvaluator.maySelect` on the folder and `where`, conservative for a `where` that reads the render scope). A record edit rebuilds the pages that read that record or loop over it, nothing more. `AssetServiceImpl.softDelete` refuses to delete a dataset with live records (`SF-DOM-0121`); export includes a record's dataset implicitly and import reports `RECORD_DATASET_MISSING` (export protocol 5).

## 4. Revision safety

Every mutation → one revision → one transaction. Key pieces:

- `RevisionCounterRepository` + `JdbcRevisionCounterRepository` — gapless, contention-safe per-project allocation (ADR-0002).
- `RevisionContext` — carried by every mutating service method; `RevisionService.allocate(...)` is called first.
- `@RevisionAware` — ArchUnit-enforced marker: the only classes allowed to call repository save/delete.
- `RevisionDiff`/`DiffService`/`JsonDiffer`/`HtmlBlockSplitter` — structural diff with block-level rich-text diffing (§7.6).
- `ProjectRestoreService` — project-wide rollback as a bulk restore in one new revision.

Concurrency token is the revision interval itself (`If-Match: "rev-{n}"`); there is no JPA `@Version` column (spec §22.5).

## 5. The two languages

- **CDL** (`template.cdl`): `CdlLexer` → `CdlParser` → AST → `CdlCompiler`/`CdlValidator` → `ContentDefinition`, plus `Diagnostic[]`. Declares editors (`EditorDefinition`, `EditorType`), bodies (`BodyDefinition`), and conditional visibility (`visibleWhen`).
- **OCTL** (`template.octl` + `template.render`): `OctlLexer` → `OctlParser` → AST → `OctlCompiler` → `CompiledTemplate` (immutable; `references()` maps each `assetType:uid` key to its UUID, `referenceUses()` to its `ReferenceUse` — `VALUE`, `REF`, `INCLUDE`). `Renderer`/`OctlRenderer` walks the compiled template against a `RenderContext`, applying `Filters` and channel `Escaping` (escaping-by-default).
- **Render SPIs** (`template.render`): `RenderContext` carries a `UrlResolver`, a `BlockResolver` (bodies, includes, catalog cards) and an `AssetValueResolver` (`valueOf(assetType, uuid)` → the target's root value object for cross-asset values, spec §16.4). `sf-template` stays free of repositories; implementations live in the pipelines: `SnapshotAssetValueResolver` (generation) and `LiveAssetValueResolver` (preview), both projecting through `asset.content.AssetValueProjection`. `AssetReferencePrefixes` (`asset.folder`) is the single prefix → `AssetType` registry.
- **Render budget**: `RenderBudget` (one per page render, passed down through nested `RenderContext`s) holds the template nesting stack and the aggregate loop, output and time counters; it raises `SF-TPL-0130`–`0133` and the include cycle `SF-TPL-0135` as `RenderLimitException`. It is mutable and must never be shared across pipeline entries.
- **Compile cache** (`asset.template`, spec §21.5): `CompiledTemplateCache` returns `CompiledChannel` (OCTL result + `ContentDefinition`). `buildMemo(snapshot)` gives generation a per-build `TemplateCompileMemo` keyed `(templateUuid, channel)`; `compile(...)` is preview's Caffeine tier keyed by `(projectId, templateUuid, validFromRevision, channel)`, validated on each hit by re-resolving the recorded reference lookups. Compiles are counted in `sf.template.compiles{kind}`. `TemplateServiceImpl` compiles uncached on save.

Diagnostics: `template.diagnostic.DiagnosticCodes` (OCTL `SF-TPL-*`, CDL `SF-CDL-*`), `generate.GenerationDiagnosticCodes` (`SF-GEN-*`). See the [template-developer guide](template-developer-guide.md) for the full code catalogue.

## 6. Generation pipeline

`generate.GenerationService` orchestrates the eight stages of §18: snapshot (`SnapshotService`/`Snapshot`) → plan (`BuildPlanner`/`BuildPlan`) → validate → render (`RenderPipeline`/`GenerationRenderer`) → assets (`AssetCopyStage`) → post-process (`PostProcessStage` + `postprocess/*`) → atomic write (`target/*`) → report. Filesystem publish is atomic via `{root}/builds/{runId}/` + `current` symlink (ADR-0005).

- **Plan.** `BuildPlanner` expands changed assets over an in-memory reverse index of the `asset_reference` edges valid at the snapshot revision (one projected `(from, to)` query per plan). It no longer derives template edges from payloads, and generation writes no reference rows. Render-time-only dependencies (a `nav:` subtree whose descendants changed) are not covered.
- **Validate and render.** All compiles of a run go through the snapshot's `TemplateCompileMemo`, shared by `RenderPipeline.validate`, the completeness check `RenderPipeline.incompletePages` (`PageContentValidator` → `SF-GEN-0120`, pages removed from the render, run `PARTIAL`) and the parallel render. Every page, section and catalog-card render gets the page's `RenderBudget` and a `SnapshotAssetValueResolver`.
- **Paths.** `channel.ChannelOutputSettings` (extension, `indexUid`, `indexFileName`, `urlStrategy` `RELATIVE|PRETTY`, `trailingSlash`) is parsed from each `OutputChannel` and read once per run through `ChannelService.outputSettings(projectId)`. `channel.OutputPathExpander` is the single path/URL rule, used by `render.OutputPathResolver` (generation) and `urlregistry.LiveOutputPathResolver` (URL registry, preview navigation). `ChannelService.outputSettingsChangedSince` makes `GenerationService` plan an `INCREMENTAL` run as `FULL` after a channel output settings change.

## 7. Media and blob store

`asset.media`: `MediaService` behind `BlobStore` (`FilesystemBlobStore` default, `S3BlobStore` optional). Bytes are content-addressed by SHA-256 (`Blob`, `BlobRepository`); `SvgSanitizer` sanitizes SVG uploads. Variants and metadata extraction per §11.4.

Processed text media (M18), also `asset.media`: `TextMediaTypes` is the one text MIME allow-list (what can be edited as text and have `processCms`); `MediaPaths` is the one media output path helper, shared by generation and preview. `TextMediaCompiler` compiles a processed source at save time through `OctlCompiler.compileTextMedia` (the text-media profile inside the normal validation walk: `SF-TPL-0121`, `0320`, `0321`) against the project reference resolver, and `ReferenceMaterializer` derives the media asset's `OCTL_*` edges from that same compile, so every version write (save, restore, import, delete) keeps them right. `TextMediaRenderer` fixes the render context (escaping `NONE`, default channel, media meta, SVG sanitized after rendering); generation calls it from `GenerationRenderer.renderMedia` with snapshot resolvers (`MediaRenderStage` inside the ASSETS stage, which walks the copy set to a fixed point), preview from `PageRenderService.renderMedia` with live resolvers at the share token's revision. Render-time compiles go through `CompiledTemplateCache` (`TemplateCompileMemo.textMedia` per build, `compileTextMedia` across requests).

## 8. Security and authorization

`sf-api.security` holds the JWT stack (`JwtService`, `RefreshTokenService`, `SfJwtAuthenticationConverter`, `ProjectAuthorizationService`). Authorization is `(user, project) → role`, evaluated per request (`@PreAuthorize("@projectAuth.has(...)")`) with a `404`-vs-`403` distinction so project existence is not leaked (§8.4). No per-asset ACLs in v1.

## 9. Data and schema

Liquibase owns the schema (`ddl-auto: validate` in every profile); see `infra/README.md` for the four profiles (`dev`, `test`, `demo`, `prod`) and database details. The schema is a strict superset of §22.2, with `dbms`-scoped changesets for PostgreSQL↔H2 portability.

## 10. Frontend

Angular 18+ standalone, zoneless + signals. The dynamic form engine (`sf-content-form` + `FormBuilderService` + `EDITOR_REGISTRY`) renders a form from the `ContentDefinition`; the revision spine is the signature UX element (§24.2). See the [user guide](user-guide.md) and `ui/src/app/features/` for the feature layout.
