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
| `sf-domain` | `asset` (incl. `asset.globals`), `revision`, `project`, `user`, `channel`, `structure`, `preview`, `generate`, `search` | entities, repositories, domain services, transactions; the embedded search index (Lucene is a dependency of this module only) |
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

Page content validation (spec §10.5): `asset.content.ContentValidator` and `PageContentValidator` are pure and return `ContentIssue`s with a `STRUCTURAL` or `COMPLETENESS` kind; `asset.page.PageContentValidation` rejects structural findings on save (`422` with `issues`).

Editor rules (M33, spec §10.5, §14.8), package `asset.rules`:

- **Compile.** `template.cdl.CdlParser`/`RulesCompiler` turn `rules {}` and the built-in modifiers into a `template.rules.RuleSet` on the `ContentDefinition`; rule expressions are compiled once (`template.expression.ExpressionCompiler`, v2; `visibleWhen` stays on v1) and evaluated by `ExpressionInterpreter` within an `EvaluationBudget`. `EffectiveDefinition.merge` merges rule sets along a page template chain (replace by name/path, `off`); `TemplateRuleCdlRules`, `DatasetCdlRules` and `GlobalSetCdlRules` check targets per kind.
- **Engine.** `RuleEngine` (pure) evaluates a definition's fills (in dependency order), states and rules for one `RuleScope` and a set of locales against a `RuleContextProvider` (meta, release status, `global:`, `ref`) → `RuleOutcome {findings, fills, fieldStates}`. The built-in checks stay in `ContentValidator`; the engine adds them to its outcome (structural ones in every scope, completeness ones in the scopes their modifiers give them).
- **Live contexts.** `RuleContexts` provides the draft context (`draft(...)`: property sets and referenced assets as drafts, the asset's release status per language) and the released context (`releasedState(...)`: as released, counting what the running release releases).
- **Save gate and edit evaluation.** `ContentRules` is what services call: `savePage` / `saveContent` run the save gate on every save path (`PageServiceImpl`, `RecordServiceImpl`, `GlobalSetServiceImpl`) — read-only enforcement against the stored version, save fills, save rules, `422 SF-API-0422` on a save-scope error; the `read-only` notes reach the response through `SaveFindings`. `ContentRules.edit` answers `POST /rules/evaluate` (`api.RulesController`) and the `edit` outcome in `PageView.issues`, `RecordDetailView.issues`, `GlobalSetDetailView.issues` and the draft check's `completeness`. `ContentRules.Session` resolves definitions once for a batch of assets (a release). `UiLanguage` picks the message language from `Accept-Language`.
- **Release and generation.** `release.ReleaseRuleCheck` (replacing `ReleaseCompleteness`) runs release fills and rules per released language; `generate.render.SnapshotRuleContexts` is the build's context over the snapshot, used by `RenderPipeline.validateContent` (replacing `incompletePages`).
- **References.** `ReferenceMaterializer` also writes `RULE_REFERENCE` rows for the property sets a CDL's rules read via `global:` (source paths `rules.<name>`, `states.<path>`, `fills.<path>`); the planner walks them as `RebuildEdgeKind.RULE_REFERENCE`.

Stores and asset types: `AssetType` is `PAGE`, `MEDIA`, `SECTION_TEMPLATE`, `PAGE_TEMPLATE`, `FOLDER`, `PAGE_REFERENCE`, `GLOBAL_SET`, `DATASET` and `RECORD`. Each leaf type lives in exactly one store, a folder hierarchy of its own (`FolderScope` `PAGES`, `MEDIA`, `NAVIGATION`, `TEMPLATES`, `GLOBALS`, `CONTENT`, mapped by `FolderScope.requiredFor`), under a fixed, protected root folder (`pages_root`, `media_root`, `navigation_root`, `templates_root`, `globals_root`, `content_root`) that project creation provisions inside its single revision and older projects get lazily.

Global property sets (M17), package `asset.globals`: a `GLOBAL_SET` holds its CDL schema *and* its values in one payload (`{contentDefinition, compiledDefinition, content}`), so a schema change and the value migration it causes (`asset.content.ContentRenameMigrator`, shared with the section-template cascade) are one version write. `GlobalSetServiceImpl` adds only what is set-specific — compile with `template.cdl.GlobalSetCdlRules` (no `body`, no `catalog`: `SF-CDL-0107`), seed, migrate, validate with `ContentValidator` — and writes through `AssetService`, so concurrency, scope checks, revisions and reference edges are the generic ones. Templates read a set through the ordinary cross-asset path: `global:` is registered in `AssetReferencePrefixes`, `AssetValueProjection` exposes a set's `content`, and `CMS_GLOBAL.<set>.<path>` is desugared by the OCTL parser (`Accessor.scope`) into `global:<set>.<path>`, so there is no globals-specific resolver.

Datasets and records (M19), package `asset.dataset`: a `DATASET` is a record schema (`{contentDefinition, compiledDefinition, titleEditor, description}`) in the fixed `datasets` folder of the Templates store; a `RECORD` is `{datasetRef, content}` in the Content store, with `datasetRef` mirrored into `asset_version.template_asset_id` so a dataset's records are one indexed query (`AssetVersionRepository.findCurrentRecordsOfDataset`, `searchCurrentRecordsOfDataset`, `findRecordsOfDatasetAt`). `DatasetServiceImpl` compiles with `template.cdl.DatasetCdlRules` (no `body`: `SF-CDL-0108`); a `renamedFrom` rename runs `RecordRenameMigration` inside the schema's batch, rewriting records in flushed chunks with one revision summary, so the rename is one revision at any dataset size. `RecordServiceImpl` validates with `ContentValidator` plus `RecordDatasetLookup` (a `reference` with `dataset "uid"` must point into that dataset — a structural `dataset` finding) and lists records by narrowing in SQL (`q`, folder) and then applying the pure query model. That model lives in `sf-template` (`template.query`: `DatasetQuery`, `DatasetQueryParser`, `DatasetQueryEvaluator`, `RecordView`), so the REST listing, preview and generation share one set of semantics; `where` is parsed by `octl.OctlExpressions`. The compiler parses a loop's arguments once into the `CompiledTemplate` (`SF-TPL-0140`) and, at save, checks fields against the schema through `ReferenceResolver.datasetDefinition` (`SF-TPL-0141`/`0142`). Records reach the renderer through `AssetValueResolver.datasetRecords` — `LiveAssetValueResolver` in preview (at the requested revision), `SnapshotAssetValueResolver` in generation (an index built once per snapshot) — and a `reference` to a record is dereferenced in `OctlRenderer.resolveSub`. Dependencies: a loop is an `OCTL_*` edge to the dataset, a record's `datasetRef` a `TEMPLATE` edge; walking back from a dataset skips its own records, and every record the `BuildPlanner` walk visits (changed, or reached through a reference) continues only to the templates with a loop that may select it before or after the change (`plan.DatasetLoopImpact`: loops found by uid in a resolver-less compile, `DatasetQueryEvaluator.maySelect` on the folder and `where`, conservative for a `where` that reads the render scope). A record edit rebuilds the pages that read that record or loop over it, nothing more. `AssetServiceImpl.softDelete` refuses to delete a dataset with live records (`SF-DOM-0121`); export includes a record's dataset implicitly and import reports `RECORD_DATASET_MISSING` (export protocol 5). Since M25 (export protocol 7) a record's archive parent is its `RECORD_SET`: export pulls a picked record's set and dataset in implicitly and exports a picked set with its records; import creates datasets, sets, then records, checks each record's placement with `RecordSetContainment` (`RECORD_SET_MISSING`, `RECORD_SET_DATASET_MISMATCH`, `RECORD_SET_DATASET_MISSING` block the import) and rejects only the records outside a set (`RECORD_OUTSIDE_RECORD_SET`, `ConflictType.rejectsAssetOnly` — every record of an older archive) while the rest imports; a set query that doesn't fit the target schema is the warning `RECORD_SET_QUERY_INVALID`.

## 4. Revision safety

Every mutation → one revision → one transaction. Key pieces:

- `RevisionCounterRepository` + `JdbcRevisionCounterRepository` — gapless, contention-safe per-project allocation (ADR-0002).
- `RevisionContext` — carried by every mutating service method; `RevisionService.allocate(...)` is called first.
- `@RevisionAware` — ArchUnit-enforced marker: the only classes allowed to call repository save/delete.
- `RevisionDiff`/`DiffService`/`JsonDiffer`/`HtmlBlockSplitter` — structural diff with block-level rich-text diffing (§7.6).
- `ProjectRestoreService` — project-wide rollback as a bulk restore in one new revision.

Concurrency token is the revision interval itself (`If-Match: "rev-{n}"`); there is no JPA `@Version` column (spec §22.5).

## 5. The two languages

- **CDL** (`template.cdl`): `CdlLexer` → `CdlParser` → AST → `CdlCompiler`/`CdlValidator` → `ContentDefinition`, plus `Diagnostic[]`. Declares editors (`EditorDefinition`, `EditorType`), bodies (`BodyDefinition`), conditional visibility (`visibleWhen`) and, since M33, editor rules (`rules {}`, `template.rules`, evaluated with `template.expression`'s v2 language; see §3).
- **OCTL** (`template.octl` + `template.render`): `OctlLexer` → `OctlParser` → AST → `OctlCompiler` → `CompiledTemplate` (immutable; `references()` maps each `assetType:uid` key to its UUID, `referenceUses()` to its `ReferenceUse` — `VALUE`, `REF`, `INCLUDE`). `Renderer`/`OctlRenderer` walks the compiled template against a `RenderContext`, applying `Filters` and channel `Escaping` (escaping-by-default).
- **Render SPIs** (`template.render`): `RenderContext` carries a `UrlResolver`, a `BlockResolver` (bodies, includes, catalog cards) and an `AssetValueResolver` (`valueOf(assetType, uuid)` → the target's root value object for cross-asset values, spec §16.4). `sf-template` stays free of repositories; implementations live in the pipelines: `SnapshotAssetValueResolver` (generation) and `LiveAssetValueResolver` (preview), both projecting through `asset.content.AssetValueProjection`. `AssetReferencePrefixes` (`asset.folder`) is the single prefix → `AssetType` registry.
- **Render budget**: `RenderBudget` (one per page render, passed down through nested `RenderContext`s) holds the template nesting stack and the aggregate loop, output and time counters; it raises `SF-TPL-0130`–`0133` and the include cycle `SF-TPL-0135` as `RenderLimitException`. It is mutable and must never be shared across pipeline entries.
- **Compile cache** (`asset.template`, spec §21.5): `CompiledTemplateCache` returns `CompiledChannel` (OCTL result + `ContentDefinition`). `buildMemo(snapshot)` gives generation a per-build `TemplateCompileMemo` keyed `(templateUuid, channel)`; `compile(...)` is preview's Caffeine tier keyed by `(projectId, templateUuid, validFromRevision, channel)`, validated on each hit by re-resolving the recorded reference lookups. Compiles are counted in `sf.template.compiles{kind}`. `TemplateServiceImpl` compiles uncached on save.

- **Template inheritance** (M20): a page template's channel compiles against its `$CMS_EXTENDS` chain. `sf-template` owns the `ParentTemplateLoader` SPI, chain linking (`OctlCompiler` + `InheritanceRules`, per-request `ChainCompileMemo`) and the effective-definition merge (`EffectiveDefinition`); `asset.template.TemplateHierarchy` is the one domain view of page templates that loads ancestors, walks `parentTemplateRef` and compiles chains — over the live data or a revision (`TemplateHierarchies`, used by save, validate and preview) or a generation snapshot (`SnapshotTemplateHierarchy`).

Diagnostics: `template.diagnostic.DiagnosticCodes` (OCTL `SF-TPL-*`, CDL `SF-CDL-*`), `generate.GenerationDiagnosticCodes` (`SF-GEN-*`). See the [template-developer guide](template-developer-guide.md) for the full code catalogue.

## 6. Generation pipeline

`generate.GenerationService` orchestrates the eight stages of §18: snapshot (`SnapshotService`/`Snapshot`) → plan (`BuildPlanner`/`BuildPlan`) → validate → render (`RenderPipeline`/`GenerationRenderer`) → assets (`AssetCopyStage`) → post-process (`PostProcessStage` + `postprocess/*`) → atomic write (`target/*`) → report. Filesystem publish is atomic via `{root}/builds/{runId}/` + `current` symlink (ADR-0005).

- **Plan.** `GenerationService.planFor(projectKey, request)` is the one snapshot → baseline → plan path, used by a run and by the dry run (`POST /generations/plan`). `BuildPlanner` lists the site's outputs and, for an incremental plan, hands the changes (version and uid changes since the baseline, with the versions they had then) to `plan.RebuildExpansion`, which walks an in-memory reverse index of the `asset_reference` rows valid at the snapshot revision (one projected `(from, to, kind, sourcePath)` query per plan). The same class answers asset impact (`ImpactService`, `GET /assets/{uuid}/impact`) with an upper-bound change model, so the planner, the dry run and impact can't disagree. The walk keeps each asset's first discovery edge (a shortest-path tree → `insight.RebuildReason` chains) and every discovered edge (a bit-set fixpoint → `causeCount`), and implements the §18.2 navigation rule. Record changes are pruned per reader: `plan.DatasetLoopImpact` for `dataset:` loops (M19.3.2), `plan.RecordSetImpact` for record set readers — the set's stored query and a loop's `where` through `RecordSetQueries.maySelect`, value reads vs. loops from `CompiledTemplate.recordSetReads` (M25.2.3). Generation writes no reference rows.
- **Baseline and carry-forward.** Each writer stores a `target.BuildManifest` next to a build. `GenerationService.baselineFor` takes the target's current build when its manifest is complete for the requested channels. `stage.CarryForward` decides which base outputs an incremental or scoped run keeps, the site pages post-processing lists and the new manifest; `TargetWriter.stage(runId, baseRunId, files, removedPaths)` stages base − removed + overlay (hard links on the filesystem), so a publish stays one flip (ADR-0005).
- **Run plans.** `PlanInsight` turns a plan into `insight.PlanEntryRecord`s and the `plan_summary` JSON; `insight.RunPlanStore` (sf-domain, JDBC batches) stores them normalized right after PLAN, reads them back with reasons, and prunes old plans. The reason model lives in sf-domain so the store can rebuild it without depending on sf-generate.
- **Validate and render.** All compiles of a run go through the snapshot's `TemplateCompileMemo`, shared by `RenderPipeline.validate`, the content rule check `RenderPipeline.validateContent` and the parallel render. `validateContent` runs the `RuleEngine` in the `generation` scope per planned page and language, with the project's `LocalizationContext` and a `SnapshotRuleContexts` over the snapshot: `error` + `holdBack` → `SF-GEN-0120`, the page language removed from the render, run `PARTIAL`; `error` + `fail` → one `SF-GEN-0121` per page, language and rule after every page was validated, run `FAILED` before anything renders; `warning`/`info` → `SF-GEN-0122` run diagnostics. Every page, section and catalog-card render gets the page's `RenderBudget` and a `SnapshotAssetValueResolver`.
- **Paths.** `channel.ChannelOutputSettings` (extension, `indexUid`, `indexFileName`, `urlStrategy` `RELATIVE|PRETTY`, `trailingSlash`) is parsed from each `OutputChannel` and read once per run through `ChannelService.outputSettings(projectId)`. `channel.OutputPathExpander` is the single path/URL rule, used by `render.OutputPathResolver` (generation) and `urlregistry.LiveOutputPathResolver` (URL registry, preview navigation). `ChannelService.outputSettingsChangedSince` makes `GenerationService` plan an `INCREMENTAL` run as `FULL` after a channel output settings change.

## 7. Media and blob store

`asset.media`: `MediaService` behind `BlobStore` (`FilesystemBlobStore` default, `S3BlobStore` optional). Bytes are content-addressed by SHA-256 (`Blob`, `BlobRepository`); `SvgSanitizer` sanitizes SVG uploads. Variants and metadata extraction per §11.4.

Processed text media (M18), also `asset.media`: `TextMediaTypes` is the one text MIME allow-list (what can be edited as text and have `processCms`); `MediaPaths` is the one media output path helper, shared by generation and preview. `TextMediaCompiler` compiles a processed source at save time through `OctlCompiler.compileTextMedia` (the text-media profile inside the normal validation walk: `SF-TPL-0121`, `0320`, `0321`) against the project reference resolver, and `ReferenceMaterializer` derives the media asset's `OCTL_*` edges from that same compile, so every version write (save, restore, import, delete) keeps them right. `TextMediaRenderer` fixes the render context (escaping `NONE`, default channel, media meta, SVG sanitized after rendering); generation calls it from `GenerationRenderer.renderMedia` with snapshot resolvers (`MediaRenderStage` inside the ASSETS stage, which walks the copy set to a fixed point), preview from `PageRenderService.renderMedia` with live resolvers at the share token's revision. Render-time compiles go through `CompiledTemplateCache` (`TemplateCompileMemo.textMedia` per build, `compileTextMedia` across requests).

## 8. Security and authorization

`sf-api.security` holds the JWT stack (`JwtService`, `RefreshTokenService`, `SfJwtAuthenticationConverter`, `ProjectAuthorizationService`). Authorization is `(user, project) → role`, evaluated per request (`@PreAuthorize("@projectAuth.has(...)")`) with a `404`-vs-`403` distinction so project existence is not leaked (§8.4); publishing operations add the project's publish policy (`@projectAuth.can(...)`, section 14). No per-asset ACLs in v1.

## 9. Data and schema

Liquibase owns the schema (`ddl-auto: validate` in every profile); see `infra/README.md` for the four profiles (`dev`, `test`, `demo`, `prod`) and database details. The schema is a strict superset of §22.2, with `dbms`-scoped changesets for PostgreSQL↔H2 portability.

## 10. Frontend

Angular 18+ standalone, zoneless + signals. The dynamic form engine (`sf-content-form` + `FormBuilderService` + `EDITOR_REGISTRY`) renders a form from the `ContentDefinition`; since M33 a `RuleBinding` per form calls `POST /rules/evaluate` debounced and applies the server's fills, field states and findings (spec §23.5), `visibleWhen` being the only expression evaluated in the browser; the revision spine is the signature UX element (§24.2). See the [user guide](user-guide.md) and `ui/src/app/features/` for the feature layout.

## 11. Content languages (M24)

Locale is a **content dimension**, not a second project. One project holds every language; only leaf values vary.

- **Configuration.** `project.LocaleConfig` (ordered languages, default, per-language fallback chains, "default
  language without URL prefix") is stored as the JSON column `project.locale_config` and read everywhere through
  `project.ProjectLocales` — one decode point, no `ProjectService` dependency, so the bean graph stays acyclic. Like
  `allowedMimeTypes`, it is overwritten in place with an `UPDATE` revision for attribution; **generating a past
  revision therefore uses the current language configuration** (a known limitation, not a bug).
- **Stored shape.** A CDL leaf editor marked `localizable` stores `{"type":"L10N","values":{"de":…,"en":…}}`.
  `common.L10nValues` is the only code that reads or writes that shape — validator, migrator, renderer, search
  extraction and export all go through it. Structural editors (`group`, `list`, `catalog`, `pagination`) can't be
  localizable (`SF-CDL-0112`): structure is shared, values are not.
- **Migration.** `asset.content.LocalizationMigrator` *normalizes* a content object to what its definition declares,
  rather than diffing two definitions, so one pass covers all four triggers (an editor gaining or losing
  `localizable`, a project gaining or losing languages) and is idempotent.
  `asset.localization.LocalizationMigrationService` owns the asset walk and the compound revision. Unwrapping loses
  translations, so it throws a `409` inside the save's own transaction unless the caller passed `confirmDiscard` —
  the rollback is what guarantees nothing was written.
- **Rendering.** `RenderContext` carries `locale` and `localeChain` (plain strings: `sf-template` still doesn't
  depend on `sf-domain`). `OctlRenderer` resolves a wrapper **once**, at value lookup, so filters, truthiness and
  `| json` never see one. `project.LocaleRenderScope` builds `$CMS_META(locale|language)$` and the `CMS_LOCALES`
  switcher for both generation and preview. `date`/`number`/`upper`/`lower` format in the render language, or
  `Locale.ROOT` — never the JVM default, which used to make output depend on the server.
- **Generation.** The plan fans out page × channel × language (`PlanEntry.locale`); `{locale}` is a path placeholder
  in `OutputPathExpander`, and a localized project's default expression is `{locale}/{folder}{uid}.{ext}`. A path
  without `{locale}` is `SF-GEN-0111` before anything renders. `url_registry_entry` keys URLs by language too
  (`locale_key`, `''` without languages). `BuildManifest.Output` and `CarryForward` carry the language, so an
  incremental run keeps the languages it didn't rebuild. Since M27 the planner walks once per language (§13), which
  replaced M24's translation-diff narrowing (`plan.LocaleValueDiff`, removed).
- **Search.** Text of a language-dependent value is indexed into that language's field (`text_de`, `text_en`), the
  neutral `text` field carrying everything so an unfiltered search still finds it; `GET /search?locale=` reads one
  language's field. Changing a project's languages requests a rebuild.
- **A project without languages** takes the original code paths, not language-aware ones that happen to agree: the
  same payloads, the same plan entries, the same output paths and the same URL registry rows as before M24.

## 12. Search

Editorial full-text search (M23) over every **current** asset of a project, in `sf-domain` package `search`, with
`SearchController` in sf-api and the startup catch-up and health indicator in sf-app. It is separate from the public
site's `search-index.json` (`SearchIndexPostProcessor`), which generation writes.

- **The database is the source of truth.** The index is a derived cache: nothing reads it to make a write decision, and
  deleting the index directory and restarting is always safe.
- **Index.** `SearchIndexServiceImpl` keeps one Lucene directory per project under `sf.search.index-root`
  (`{root}/{projectId}`; `ByteBuffersDirectory` with `sf.search.directory=memory` in tests), with a lazily opened
  `IndexWriter` and `SearcherManager`. Searches and writes hold the project's read lock; closing and the rebuild swap
  hold its write lock, so no reader has files open while directories are renamed (Windows). Documents
  (`SearchDocument`, fields in `SearchFields`): keyword `uuid`, `type` (+ doc values for facets), `uid`/`uid_lower`,
  `folderPath`; `title` (display name + uid); prose in `text` (neutral: lowercase, German normalization, ASCII
  folding), `text_de` and `text_en` (stemming); code in `source` (neutral only); a stored `snippetSource`.
- **Extraction.** `extract.SearchTextExtractorRegistry` picks one `SearchTextExtractor` per type. `ContentTextWalker`
  walks content by its definition — page templates' effective definitions (`TemplateHierarchies`), section templates
  for sections and catalog cards, datasets for records, a global set's own CDL — and falls back to every string leaf
  when a definition is gone. Rich text becomes plain text through `HtmlText` (sf-common), which the OCTL `plain`
  filter shares. Definitions compile through `CompiledTemplateCache`, keyed by template version.
- **Lifecycle, one path.** `RevisionServiceImpl.allocate` publishes a `RevisionCommittedEvent`; the after-commit
  `SearchIndexingListener` only asks `SearchIndexer` to sync the project (a rolled-back transaction delivers nothing,
  a joined batch publishes no second event). Syncs run on virtual threads, one at a time per project, coalesced to at
  most one pending run. A sync compares the index's commit data — revision stamp, `SearchSchemaVersion`, owner
  (project key + creation time) — with the database:
  - no index, unreadable, other schema, other owner (a leftover index of another database), stamp ahead of the
    database, or more than `sf.search.catch-up-max-revisions` behind: **rebuild** into `{id}.rebuild-{ts}` from the
    current versions in batches, stamped with the head revision captured before it started, then swap under the write
    lock;
  - then **replay** the revisions after the stamp: assets in their `summary.assets` or with a version opened in them
    (a uid change writes no version, a folder move changes descendants without summary entries), plus the pages,
    records and child templates of a template or dataset whose CDL, parent or deleted state changed (reverse
    `TEMPLATE` and catalog-card edges). Each is upserted from its current version or deleted.
  - The stamp is written in the same Lucene commit as the documents and advances only to the highest revision R such
    that every revision up to R exists and none of its assets failed, so it may lag but never runs ahead.
  - Startup (`SearchIndexCatchUpRunner`) and `POST /search/reindex` request the same sync; archiving a project closes
    its index.
- **Queries.** `SearchQueryExecutor` never parses user input as query syntax: `SearchInput` tokenizes it (≤ 32 words,
  quoted phrases), and the query is built from term, phrase and prefix clauses (uid exact 10, uid prefix 6, title
  phrase 5, title terms 4, body 1; a fuzzy second pass on no hits). Filters don't score. Facets come from a collector
  over the query without its type filter; `matchedIn` from the Matches API; snippets from
  `UnifiedHighlighter.highlightWithoutSearcher` with a formatter that returns offsets.
- **Single instance.** Lucene's `write.lock` allows one writer per directory. A project whose lock is held elsewhere is
  `UNAVAILABLE` (logged, `503 SF-SEARCH-0503`, health detail `DEGRADED`); the application still starts. See
  `infra/docs/deploy-runbook.md`.
- **UI.** `features/search/` (search page, `SearchService` with the debounced, cancelling as-you-type stream) and the
  command palette (`core/ui/command-palette`) share `shared/asset-route.util.ts`, which maps a hit to its screen
  (`pages/:uuid`, `content/records/:uuid`, or `?asset=`/`?folder=` deep links that the stores apply once and clear).

## 13. Release state and scheduler (M27)

Spec §5.5, §10.4, §11.6, §18.2, §18.7. Editorial content has drafts and, per language, released versions; generation
renders the released ones.

- **Model** (`sf-domain` package `release`). `AssetRelease` rows (`asset_release`) are revisioned like
  `asset_reference`; `ReleasableTypes` is the one place that says which assets are released, `ReleaseLocales` which
  locale keys an asset has. `ReleaseStatusService` computes statuses in bulk (pointers, release history, released
  versions — a fixed number of chunked queries per call) by comparing `LocaleProjection`s, a pure function with a
  per-call memo. `ReleaseStates.at(project, R)` is the release state at a revision (builds, time travel, preview).
- **Actions.** `ReleaseService` (plan, release, unpublish, discard) resolves and checks every item first and then
  writes one batch revision, so a refusal leaves the counter untouched; `ReleaseRuleCheck.checker` (M33: release fills and rules through one
  `ContentRules.Session` per call) validates, and a fill that changes a released draft writes a new version in the
  release revision; the dependency walk is breadth-first per layer with bulk reads. Permission is one hook,
  `ReleasePermissionCheck`, implemented by `PolicyReleasePermissionCheck` (M28: the `RELEASE` publish permission,
  evaluated by `PublishPermissionEvaluator` from the database because a schedule runs without a token; it replaced
  M27's `RoleReleasePermissionCheck`). `ReleaseCarryForward` moves pointers along with system migrations (its own
  component: the migrations are lower-level writers than `ReleaseService`). `ReleaseStateInitializer` migrates
  unflagged projects on start. `ChangesService` answers the Changes list from a candidate query plus projections.
- **Rendering.** `SnapshotService` loads a released `Snapshot`: a family of per-language views in which an asset not
  released in the language is present as an *absent marker* (`deleted = true, unreleased = true`), so every consumer
  that skipped tombstones skips it at the same places and a link to it resolves to `SF-GEN-0221`. `RenderPipeline`
  holds one `GenerationRenderer` per view. `RebuildExpansion` seeds per language from pointer changes (`Delta`) and
  walks released versions' edges too. Preview reads through `ContentView` (draft or published, current or at a
  revision), the live counterpart of a snapshot view; share tokens carry the view.
- **Localized media.** `MediaFiles` is the one payload helper (`fileFor`, `effective`); `MediaOutputs` the one output
  rule for links, copies and carry-forward (own file under the language's prefix, fallback links the owner's file or
  writes its own copy).
- **Scheduler** (`sf-domain` package `scheduler`). `SchedulerEngine` is a plain class (a bean from
  `SchedulerConfiguration`; tests build engines with their own node id and clock): one poller thread, executions on
  virtual threads, a lease keeper. `LeaseClaimer` is the table-agnostic conditional-update claim (reusable by M29's
  instance jobs). `ScheduleTiming` owns cron normalization, zones and DST. Handlers implement `ScheduledActionHandler`:
  `ReleaseActionHandler`/`UnpublishActionHandler` in `sf-domain`, `GenerationActionHandler`/
  `RecurringGenerationActionHandler` in `sf-generate`; "then generate" goes through the port
  `ScheduledGenerationStarter` (declared in `sf-domain`, implemented by `sf-generate`'s `ScheduledGenerations`), since
  `sf-domain` may not depend on generation. `ActionAuthority` is the single owner/caller check both the API and the
  engine use; since M28 it evaluates the handler's `PublishRequirements` through `PublishPermissionEvaluator`
  (section 14). Handlers checkpoint progress in the transaction of each step, so a re-claimed execution never repeats a
  committed one. `ScheduleService` holds the API rules; `scheduled_action_asset` answers "schedules touching these
  assets" in one query.
- **UI.** `features/release` (badge, release bar, dialogs, `ReleaseEventsStore` — a
  counter every status display re-reads on, plus the last status a release bar read so lists patch their row without
  reloading), `features/changes`, `features/schedules` (dialog, page, history, `zoned-time.util` on the platform `Intl`
  API, cron presets). Statuses always come from the server's `release` blocks; the client never computes one. Who may
  release or schedule comes from `ProjectPermissionsStore` (section 14; M27's `ReleasePermissionsStore` is gone).

## 14. Editor publishing (M28)

Spec §8.3, §8.4, §18.1, §18.7. A per-project **publish policy** opens release, scheduled release, incremental and full
builds to editors; everything else keeps its role check.

- **One rule** (`sf-domain` package `project.publish`). `PublishPermission` (`RELEASE`, `SCHEDULE_RELEASE`,
  `INCREMENTAL_BUILD`, `FULL_BUILD`); `PublishPolicy` (the editor set, stored as `project.publish_policy` JSON,
  changelog `v1.0/025`) with `grants(role, permission)` — the only place that says who holds what — and `validate()`
  for the two implications; `PublishRequirements` (a minimum role plus permissions, `missing(role, policy)` → the
  first thing lacking, a permission name or `ROLE:<role>`), the one requirement type for every path.
- **Two evaluators, same answer.** `ProjectAuthorizationService.can`/`satisfies` (`sf-api`) take the role from the
  token and read the policy through `ProjectService.publishPolicy` on every call (no cache, nothing in a claim, so a
  change applies on the next request); a denial is `403 SF-API-0403` with `permission`. `PublishPermissionEvaluator`
  (`sf-domain`) takes the role from the membership row and the account state (disabled or deleted: nothing; locked:
  unchanged; instance admin: everything) for callers without a token: `ActionAuthority` (schedule API and every
  execution, and `ScheduleService.policyImpact` with a proposed policy), `PolicyReleasePermissionCheck`.
  `PublishPolicyApiTest` checks that both agree on every role × policy × permission.
- **Who needs what.** Release endpoints: `@projectAuth.can(#projectKey, 'RELEASE')`. Generation: `GenerationAuthorization`
  (`sf-domain` package `generate`) maps a request (mode, target, revision) to requirements; the controller applies it
  to start and dry run, `ReleaseStateActionHandler.requirements` to a scheduled release's "then generate" on the stored
  target. Scheduled actions: each handler's `requirements(spec)`; `ScheduleService.forActor` adds `DEVELOPER` when the
  caller changes someone else's action. The publishing controllers write role-only guards as
  `can(#projectKey, 'ROLE:X')` so their denials name the role; a context test scans every literal.
  `PublishPermissionMatrixTest` walks every mutating handler of these controllers for every role and valid policy and
  fails on a handler without an expectation.
- **Attribution.** `GenerationService` audits `GENERATION_STARTED` (with `scheduledActionId` for scheduled starts),
  `GENERATION_CANCELLED` and `GENERATION_PROMOTED`, and scopes its in-memory `Idempotency-Key` map by project and
  user; `GenerationRunView.startedBy` is resolved with one user lookup per list of runs. `ProjectServiceImpl.updatePublishPolicy`
  writes the column in place, allocates an `UPDATE` revision for attribution and audits `PUBLISH_POLICY_SET`.
- **UI.** `core/project/ProjectPermissionsStore` is the one permission helper (effective role, `ProjectDetail.permissions`,
  `readOnly`); it replaced the ad-hoc `ROLE_RANK`/`roleFor` checks of the content, globals, search and members screens.
  `publish-permissions.ts` maps a `permission` to the "You no longer have permission to …" wording; the error
  interceptor re-reads the project detail on such a `403`, and `ProjectContextStore` re-reads it on every navigation
  (coalesced: one read at a time, plus one more when a navigation happened during it) and on tab visibility (≤ once a
  minute). `features/settings` holds the "Publishing by editors" card,
  `features/generation/BuildNowService` the "Build now" offer after a release. Toasts are rendered by
  `core/ui/ToastHostComponent` (in the app shell since M28; polite and assertive live regions, optional action button).

