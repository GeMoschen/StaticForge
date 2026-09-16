# M18 implementation — Plan

## Approach
Sequential on branch `m18-parsable-text-media` (off `m17-global-store`, master untouched). The features are a
strict chain (domain → compile-on-save → generation/preview → UI → docs/E2E), so no worktree fan-out.

## Design (from reading the code)
- **One compile entry point.** `OctlCompiler.compileTextMedia(source, channel, resolver, mimeType)` in `sf-template`:
  compiles against an *empty* content definition (bare names are unknown editors, `CMS_GLOBAL` misuse is checked) plus
  a text-media profile inside the existing validation walk: `$CMS_BODY`, `$CMS_INCLUDE` and leaf `$CMS_NAVIGATION` →
  new error; `$$` → warning (positions recorded by the lexer, skipped inside `$CMS_COMMENT$`); unescaped
  `$CMS_VALUE` in JS/JSON → warning. No parser fork.
- **`TextMediaTypes`** (`sf-domain`, `asset.media`): the allow-list, `isText(mime)`, `isProcessed(payload)`.
- **Reference edges via `ReferenceMaterializer.extract(MEDIA, payload)`**: a processed media payload's edges come from
  compiling its blob (source path `source`). Every version write already calls the materializer, so save, flag off,
  soft delete, restore and import stay correct with no media-only copy.
- **`TextMediaRenderer`** (`sf-domain`): compile (cache) + render with escaping `NONE`, default channel, media meta,
  caller-supplied URL/value/nav resolvers, SVG re-sanitize. Used by generation (snapshot resolvers) and by preview
  (live resolvers at the token's revision).
- **Generation:** `MediaRenderStage` used by `AssetCopyStage`; copy set closed transitively over processed media
  dependencies; `BuildPlan.processedMedia` filled by the planner's BFS.
- **Preview:** media share tokens carry an optional revision; `shareBinary` renders processed media;
  `GET /binary?rendered=true`.

## Decisions
Confirmed with the user (all the task files' recommendations):
- A processed media render error makes the run **PARTIAL**; the file is not written and no previous content is substituted.
- A text save whose bytes equal the stored blob creates **no revision** (a stale `If-Match` still 409s).
- `GET /binary?rendered=true` is **EDITOR+**.
- Processed media edges are derived in **`ReferenceMaterializer`** from the compiled blob.

## Steps
- [x] M18.1.1 `processCms` flag, `TextMediaTypes`, `MediaPaths` json/xml, DTO fields, Tika sample check
- [x] M18.1.2 `GET`/`PUT /media/{uuid}/text`
- [x] M18.2.1 text-media compile profile + diagnostics, compile on flag/text/replace, validate endpoint, reference edges, uid-literal scan
- [x] M18.3.1 render processed media in generation, transitive copy set, incremental plan
- [x] M18.3.2 preview/share + `?rendered=true`
- [x] M18.4.1 media drawer: toggle, Source, Rendered, library badge; `schema.d.ts`
- [x] M18.5.1 docs, spec, API doc, `m18-journeys.spec.ts` run live
- [x] Full `./gradlew build` + `ng build`, review section

## Review
- **Branch:** `m18-parsable-text-media` (off `m17-global-store`; master untouched). Not committed.
- **Verification:**
  - `./gradlew build` green: 601 backend tests (510 at M17), 0 failures, 1 skipped (benchmark). Benchmark run
    separately: 500 pages, full 2.1 s, incremental 0.12 s (§18.6: < 20 s / < 2 s).
  - `ng build` green; vitest has only the 19 known `templateUrl` spec failures.
  - Live, against a dev backend + `ng serve`: `m18-journeys` 2/2, `m16-journeys` 5/5, `m17-journeys` 4/4.
- **Design in one line each:** `OctlCompiler.compileTextMedia` (profile in the existing walk); `TextMediaTypes`
  and `MediaPaths` in `asset.media`; edges from `ReferenceMaterializer`; one `TextMediaRenderer` for generation
  and preview; `MediaRenderStage` + a fixed-point copy set; `BuildPlan.processedMedia`; revision-pinned media
  share tokens.
- **Changes beyond the task files (found during implementation/verification):**
  - **Bug:** the OCTL lexer skipped the 5 characters of `$CMS_` when counting columns, so diagnostics after an
    instruction on the same line pointed 5 columns too far left.
  - **Bug:** the UID-rename literal scan had no `global:` prefix (its Javadoc said both spellings were matched).
  - **Bug, pre-existing, found by the live journey:** the editor preview's `[srcdoc]` went through Angular's HTML
    sanitizer, which stripped `<link>`, `<style>`, `<script>` and `id`: no preview ever loaded a stylesheet. The
    frame now binds a trusted value and its sandbox dropped `allow-same-origin` (scripts run in an opaque origin).
  - `application/manifest+json` added to the text allow-list (Tika's type for `.webmanifest`).
  - `MediaPaths` moved from `sf-generate` to `sf-domain` so preview shares it.
  - The media route is lazy-loaded: the drawer growth broke the 900 kB initial bundle error budget.
  - Planner: a merely *reached* processed file stops the reverse walk (a changed one continues), otherwise a
    global-only change would re-render every page linking the stylesheet (see `M18.3.1` Review).
  - Time-travel page previews now serve every media file at the viewed revision (the token carries it).
- **Open / not done:**
  - Incremental builds still don't carry unchanged files forward (`M22.4.1`); processed media is part of the run.
  - `.mjs` is detected as `text/plain` and published as `.txt`.
  - The drawer's component spec can't run (`templateUrl` runner issue).

---

# M17 implementation — Plan

## Approach
Sequential on branch `m17-global-store` (off `m16-foundations`, master untouched). The epic's
tracks are dependency-chained (domain → api → ui; octl needs domain), so no worktree fan-out.

## Decisions taken from the task files' recommendations (confirmed with the user)
- **Shared tree node + migrate Navigation.** New `shared/components/sf-store-tree-node.*`;
  `features/navigation/` is ported onto it and `nav-tree-node.*` deleted. Media/Templates/Pages
  trees stay untouched.
- **`$CMS_REF` path resolution fixed generally, for every prefix.** A path'd asset reference
  (`page:about.heroImage`, `global:site.logo`) now resolves the cross-asset value and links the
  resulting editor value, instead of silently referencing the asset itself. Keeps one resolution
  path for `$CMS_REF(CMS_GLOBAL.site.logo)$` and fixes a latent bug.
- **`PROTOCOL_VERSION` 3 → 4**, so an older server refuses a globals-carrying archive with the
  existing `PROTOCOL_VERSION_MISMATCH` conflict instead of crashing in `AssetType.valueOf`.
- **`CMS_GLOBAL` is parser-level sugar.** `OctlParser` rewrites `CMS_GLOBAL.<setUid>.<rest>` into
  `Accessor("global", setUid, rest)`, so compile-time resolution, reference edges, dependency
  recording and snapshot/live rendering all reuse the M16 cross-asset path. No second resolver.

## Steps
- [x] M17.1.1 `AssetType.GLOBAL_SET`, `FolderScope.GLOBALS`, `globals_root` provisioning
- [x] M17.1.2 `GlobalSetService` (create, schema+migration, values, CDL restrictions)
- [x] M17.1.3 Export/import, diff, usages coverage
- [x] M17.2.1 `GlobalsController` + DTOs + OpenAPI regeneration
- [x] M17.3.1 `global:` prefix, `CMS_GLOBAL` accessor root, dependency edges
- [x] M17.4.1 Globals store UI + shared tree node + Navigation migration + export picker
- [x] M17.5.1 Docs + spec follow-up
- [x] M17.5.2 E2E journeys, regression pass, full verification
- [x] Review section

## Review
- **Branch:** `m17-global-store` (off `m16-foundations`; master untouched).
- **Verification:**
  - `./gradlew build` green: 510 backend tests (457 at M16), 0 failures, 1 skipped (benchmark), plus `ng build`.
  - Live against a dev backend + `ng serve`: `ui/e2e/m17-journeys.spec.ts` 4/4 and `m16-journeys.spec.ts` 5/5.
  - The docs' worked example is pinned verbatim by `GlobalsDocsExampleTest`.
- **Why so little render code changed:** `global:` plugs into M16's cross-asset path (`AssetReferencePrefixes`,
  `AssetValueProjection`, snapshot/live resolvers, `ReferenceMaterializer`, `BuildPlanner`). `CMS_GLOBAL.<set>.<path>`
  is desugared in the parser, so both spellings are one AST.
- **Changes beyond the task files (agreed or found during verification):**
  - `$CMS_REF` on a path'd asset reference now links the editor's value (was: silently linked the asset). This
    applies to every prefix; agreed with the user.
  - `sf-store-tree-node` is shared and Navigation is migrated onto it; agreed with the user.
  - `PROTOCOL_VERSION` 3 -> 4; agreed with the user.
  - **Bug, found by the export/import round-trip test:** import silently dropped `GLOBAL_SET`. `NON_FOLDER_ORDER`
    is now a checked `AssetType` list.
  - **Bug, pre-existing since M16, found by the live journey:** the page editor pinned its preview to the page's
    concurrency token, which froze template and cross-asset/global values at the page's last save. Fixed with the
    preview frame's `revision` (time-travel pin) vs `refreshKey` split.
  - `ContentRenameMigrator` is extracted from `TemplateServiceImpl`. The template cascade now also walks
    transparent groups.
- **Open / not done:**
  - Usages list the template that reads a set, not the pages. This is by M16 design (spec §16.4); the epic's
    criterion is annotated.
  - UI component specs can't run (`templateUrl`). The Analog plugin experiment is recorded in `M17.4.1`'s notes.
  - A template that uses a set in both `$CMS_VALUE` and `$CMS_REF` appears twice in usages (one `OCTL_VALUE` and
    one `OCTL_REF` row). This is generic behaviour, left as is.
  - Lazy `globals_root` provisioning for pre-M17 projects is its own revision, like the other store roots.
  - A values save re-compiles the set's CDL (it's not a render path). Rendering never compiles set CDL.

---

# M16 implementation — Plan

## Approach
- Four parallel tracks, each in its own git worktree/branch (tasks inside a track run sequentially):
  - **T1 render:** M16.2.1 → M16.5.1 → M16.1.1 → M16.2.2 (sf-template renderer/context, `GenerationRenderer`, `PageRenderService`)
  - **T2 references:** M16.3.1 → M16.3.2 → M16.3.3 (`ReferenceMaterializer`, write paths, `BuildPlanner`, usages, Liquibase)
  - **T3 channel settings:** M16.4.1 (path resolution, URL registry, channels UI)
  - **T4 validation:** M16.5.2 (`PageServiceImpl`, `RenderPipeline.validate`)
- Integrate on branch `m16-foundations` (master untouched): merge T1..T4, resolve conflicts, regenerate `schema.d.ts`, full `./gradlew build` + `ng build`.
- Then M16.6.1: journeys, benchmark, docs/spec sync, live-app verification.

## Decisions taken from the task files' recommendations
- Add `ReferenceKind.NAV`; the compile cache adds Caffeine; the cross-request key is validated by re-resolving references
- Validation on save: structural only; for section operations validate the changed subtree, for full updates the whole page
- A channel settings change resets non-overridden URL registry entries; payload indexes in `BuildPlanner` are deleted once `TEMPLATE` rows exist

## Steps
- [x] T1 render track
- [x] T2 references track
- [x] T3 channel settings track
- [x] T4 validation track
- [x] Integrate on `m16-foundations` + full verification (`./gradlew build` green: 454 tests, 0 failures, 1 skipped)
- [x] Extra fixes found during M16: form engine nested CDL `group` values under `_group_N`; project restore left tombstones open
- [x] M16.6.1 journeys, benchmark, docs
- [x] Review section

## Review
- **Branch:** `m16-foundations` (master untouched). Four worktree tracks + docs branch merged; conflicts were
  mechanical (`RenderPipeline`, `GenerationService`, `ChannelServiceImpl`, `TemplateServiceImpl`, tests using the old
  `forSnapshot(...)` tuple).
- **Verification:** `./gradlew build --rerun-tasks` green (457 tests, 0 failures, 1 skipped = benchmark; includes
  `ng build`). `ui/e2e/m16-journeys.spec.ts` 5/5 against a live dev backend + ng serve. Benchmark 5,000 pages:
  full 6.8–10.5 s, incremental 336–471 ms (master: 8.8 s / 0.38 s medians); G5 holds.
- **Integration fixes beyond the tracks:**
  - Form engine stored CDL `group` children under `_group_N` (would block publish via `SF-GEN-0120`) → flattened,
    legacy fallback, `form-builder.service.spec.ts` (fails on old code).
  - `ProjectRestoreService` left tombstones open (two open versions) → `findOpenByProject`; 2 regression tests (fail
    on old code).
  - Render-limit errors failed the whole run → page-scoped, run `PARTIAL` (`IncludeCycleGenerationIntegrationTest`).
  - Unpinned runs omitted deleted assets (`SF-TPL-0110` instead of empty + warning) → pinned to head revision,
    `SF-GEN-0220` for deleted `$CMS_REF`/include/section targets.
  - Preview frame blank on render errors → shows problem code/detail (`preview-error.spec.ts`).
  - `BuildPlanner` redundant second edge load removed (projected `ReferenceEdge`), unused render dependency map
    removed, generation completeness check shares the build compile memo, last duplicate prefix mapper removed.
- **Open / not verified:**
  - Liquibase `015-revision-aware-references.xml` not run on PostgreSQL (none available; changeset is a plain
    `createIndex` + `delete`, reviewed as portable). Epic exit criterion left unticked for that reason.
  - Channels UI settings fields verified via journey 3 in the browser; no component spec (templateUrl specs broken).
  - Known, out of M16 scope: Angular sanitizes the preview `srcdoc` (strips template `<style>`/`<script>`); older
    e2e journey files (m3–m15) use outdated login selectors; render-time `nav:` subtree changes aren't in the
    incremental graph (M22.1.1).

---

# Feature roadmap M16–M24 — task breakdown — Plan

## Goal
Create task breakdowns (epic README → feature README → task files, same format as `M15`) for the
selected features: parsable text media, global store, content store, template inheritance,
multi-language, build insight, pagination, global search — plus a foundations epic for gaps the
features depend on. **Planning only; no code.**

## User decisions (2026-09-15)
| Topic | Decision |
|---|---|
| Existing gaps (cross-asset `$CMS_VALUE` unimplemented, `asset_reference` only written by generation + never closed, no compile cache, channel path settings unwired, include cycle guard, no server-side content validation) | Separate foundations epic **M16** first |
| Parsable text media | Per-media `processCms` toggle, text MIME only, in-app text editing (each save = revision), rendered once per generation with escaping NONE |
| Global store | Named property sets (`GLOBAL_SET` assets, CDL schema, own "Globals" store); `$CMS_VALUE(global:site.title)$` + `$CMS_GLOBAL.site.title$` |
| Content store | `DATASET` schema asset + one `RECORD` asset per entry in a foldered "Content" store; `$CMS_FOR(r : dataset:team, where=…, sort=…, limit=…)$` |
| Template inheritance | `abstract` page templates, multi-level `$CMS_EXTENDS$` / `$CMS_BLOCK$` / `$CMS_PARENT$`, child inherits parent CDL editors + bodies; page templates only |
| Multi-language | Per-editor `localizable` (value `{type:"L10N", values:{de,en}}`), project locales + default + fallback chain; `{locale}` path placeholder, default pattern prefixes all, setting "default locale without prefix", hreflang |
| Pagination | New CDL editor type `pagination` (source nav folder / dataset, page size, sort); planner emits N entries; `$CMS_PAGINATION…$` scope |
| Build insight | Reason chain per plan entry stored per run + `POST /generations/plan` dry run |
| Global search | **Embedded Lucene index** (after-commit indexing, rebuildable, single-instance hazard documented) |
| Order | Dependency order M16 → M24 (multi-language last) |

## Skeleton (IDs are binding for cross-epic `depends`)

### M16 — render-reference-foundations (`16-m16-render-reference-foundations`)
- 1 compile-cache: M16.1.1 `CompiledTemplateCache` (OCTL + CDL) used by generation + preview
- 2 cross-asset-values: M16.2.1 `AssetValueResolver` SPI in `RenderContext` + renderer; M16.2.2 generation (snapshot) + preview (live) implementations, dependency recording, golden tests
- 3 reference-materialization: M16.3.1 content references written on save in the same revision + previous rows closed; M16.3.2 template OCTL references (`OCTL_INCLUDE`/`OCTL_VALUE`/`OCTL_REF`) written on template save; M16.3.3 revision-aware reference queries, `BuildPlanner`/usages migrated, generation stops inserting, duplicate cleanup changeset
- 4 channel-path-settings: M16.4.1 channel settings (index file, trailing slash, URL strategy, file extension) wired into `OutputPathResolver`/`LiveOutputPathResolver`
- 5 render-safety-validation: M16.5.1 include cycle guard across nested renders + diagnostic constants; M16.5.2 server-side `ContentValidator` on page/section save
- 6 e2e-verification: M16.6.1 regression + journey

### M17 — global-store (`17-m17-global-store`)
- 1 domain: M17.1.1 `GLOBAL_SET` asset type + `GLOBALS` folder scope + root provisioning; M17.1.2 `GlobalSetService` (schema DEVELOPER / values EDITOR, CDL compile, validation, references); M17.1.3 export/import + diff/usages coverage
- 2 api: M17.2.1 `GlobalsController` + DTOs + OpenAPI regen
- 3 octl: M17.3.1 `global:` prefix + `$CMS_GLOBAL$` scope, generation/preview resolvers, dependency edges → incremental rebuild
- 4 ui: M17.4.1 Globals store (nav rail, tree, set value editor, schema editor, time-travel read-only)
- 5 docs-e2e: M17.5.1 docs; M17.5.2 E2E journey

### M18 — parsable-text-media (`18-m18-parsable-text-media`)
- 1 domain: M18.1.1 `processCms` flag + text MIME allow-list + extension mapping; M18.1.2 text content editing endpoint (new blob, revision, SVG sanitize)
- 2 compile-on-save: M18.2.1 OCTL validation on flag/content change + reference materialization
- 3 generation-preview: M18.3.1 render stage for processed media in generation + incremental planning of media entries; M18.3.2 preview/share serves rendered output
- 4 ui: M18.4.1 media drawer toggle + text editor with diagnostics
- 5 docs-e2e: M18.5.1 docs + E2E

### M19 — content-store (`19-m19-content-store`)
- 1 domain: M19.1.1 `DATASET` + `RECORD` asset types + `CONTENT` scope; M19.1.2 `DatasetService`/`RecordService` + schema-change migration of records (compound revision); M19.1.3 export/import + usages + diff
- 2 api: M19.2.1 controllers + paginated/filterable record listing
- 3 query-octl: M19.3.1 pure dataset query model (where/sort/limit/offset) in sf-template; M19.3.2 `$CMS_FOR(… : dataset:uid, …)$`, `record:` values, reference editor to records, resolvers + dependency edges + golden tests
- 4 ui: M19.4.1 Content store + dataset schema editor; M19.4.2 record grid + record editor + picker support
- 5 docs-e2e: M19.5.1 docs; M19.5.2 E2E

### M20 — template-inheritance (`20-m20-template-inheritance`)
- 1 language: M20.1.1 lexer/parser/AST `EXTENDS`/`BLOCK`/`END_BLOCK`/`PARENT` + diagnostics; M20.1.2 compiler chain resolution (cycle, depth cap, block merge) + golden runner with stub resolver
- 2 domain: M20.2.1 `abstract` page templates + effective (inherited) CDL; M20.2.2 parent-change cascade validation (compound revision), `TEMPLATE` edges child→parent, planner rebuilds descendants' pages
- 3 rendering: M20.3.1 generation + preview render linked templates
- 4 ui: M20.4.1 template IDE: abstract toggle, parent + effective editors, OCTL diagnostics via context-aware validate endpoint
- 5 docs-e2e: M20.5.1 docs + E2E

### M21 — pagination (`21-m21-pagination`)
- 1 cdl: M21.1.1 `pagination` editor type (attributes, stored value, one-per-template diagnostic, editor doc)
- 2 planning: M21.2.1 planner emits N entries (`pageNumber`), `{pageNumber}` path pattern, collision detection, deps keyed per entry; M21.2.2 sitemap/search index/URL registry/canonical + rel prev/next
- 3 rendering: M21.3.1 `$CMS_PAGINATION$` scope in generation + preview (`?page=n`) + golden tests
- 4 ui: M21.4.1 pagination editor component + preview page selector
- 5 docs-e2e: M21.5.1 docs + E2E

### M22 — build-insight (`22-m22-build-insight`)
- 1 planner: M22.1.1 reason chains in `BuildPlanner` (incl. §18.2 navigation-change rule); M22.1.2 `generation_run_plan` persistence
- 2 api: M22.2.1 `POST /generations/plan` dry run + `GET /generations/{runId}/plan`; M22.2.2 `GET /assets/{uuid}/impact`
- 3 ui: M22.3.1 dry-run preview in generation dialog; M22.3.2 run "Rebuilt pages" tab + asset impact panel
- 4 incremental-correctness: M22.4.1 incremental runs publish the complete site (carry-forward of unchanged output per target, removed paths, full site page list for sitemap/search index, per-target baseline) — **verified existing bug, do first**
- 5 docs-e2e: M22.5.1 docs + E2E

### M23 — global-search (`23-m23-global-search`)
- 1 index-core: M23.1.1 Lucene dependency + `SearchIndexService` (per-project directory, document model, analyzers); M23.1.2 text extraction per asset type
- 2 index-lifecycle: M23.2.1 after-commit incremental indexing from revision summary; M23.2.2 index revision stamp, startup rebuild, admin reindex endpoint, project delete
- 3 query-api: M23.3.1 `GET /search` (paging, highlights, type facets, safe query parsing)
- 4 ui: M23.4.1 Ctrl+K command palette; M23.4.2 full search page with facets
- 5 docs-e2e: M23.5.1 docs + benchmark + E2E

### M24 — multi-language (`24-m24-multi-language`)
- 1 project-locales: M24.1.1 project locale config (domain, API, revisioned); M24.1.2 settings UI tab
- 2 cdl-storage: M24.2.1 `localizable` CDL attribute + `L10N` value shape + validation; M24.2.2 toggle migration (compound revision) + localizable media metadata + nav labels
- 3 rendering: M24.3.1 locale in `RenderContext`, fallback resolution, `$CMS_META(locale)$`, locale-aware filters, `$CMS_LOCALES$`; M24.3.2 generation fan-out page×channel×locale, `{locale}` placeholder, URL registry locale key, hreflang; M24.3.3 locale-aware globals/datasets/pagination/search
- 4 ui: M24.4.1 editor locale switcher + fallback indicator (pages, globals, records, media); M24.4.2 missing-translation indicators
- 5 export-import: M24.5.1 locale settings in archive + protocol bump
- 6 docs-e2e: M24.6.1 docs + E2E

## Steps
- [x] 1. Write skeleton (this file)
- [x] 2. Write epic/feature/task files per epic (one subagent per epic, in parallel)
- [x] 3. Add M16–M24 to `tasks/README.md` epic map
- [x] 4. Verify: every skeleton ID exists, front-matter parses, `depends` ids exist, no dangling links

## Review
- **Output:** 131 files in `tasks/16-…` to `tasks/24-…`: 9 epic READMEs, 47 feature READMEs, 75 task files.
- **Checks (script):** all 75 skeleton IDs have exactly one task file, with none extra; every front-matter has
  `id/status/depends/epic/feature/area` and `status: todo`; all `depends` resolve; no dependency cycles; no epic
  depends on a later epic; no broken relative `.md` links.
- **Verified existing bugs found while planning (now tracked as tasks):**
  - Incremental generation publishes an incomplete site. `FilesystemTargetWriter.stage` writes only rebuilt files
    into a fresh build dir and `current` is flipped to it → M22.4.1.
  - `RenderPipeline` stores dependencies per page UUID with `put`, so multi-channel pages lose deps → M21.2.1.
  - Include cycle probably ends in `StackOverflowError`: nested renders reset `State` (found by reading the code,
    not run) → M16.5.1.
  - `GenerationService` passes the invalid URL strategy `"DEFAULT"`, and channel settings are ignored → M16.4.1.
  - `asset_reference` rows are never closed and are only written by generation → M16.3.x.
  - Cross-asset `$CMS_VALUE` renders empty → M16.2.x.
  - `ContentValidator` is never called → M16.5.2.
- **Decisions the writers made (each recorded in its epic Notes; review before implementing):**
  - M16.5.2: structural errors return 422 on save; `required` fails only at generation (`SF-GEN-0120`), per spec §10.5
    and autosave.
  - M16.1.1: Caffeine needs to be added. The cache key must include resolved references, not just the source.
  - M17: shorthand is `$CMS_VALUE(CMS_GLOBAL.site.title)$` (like `CMS_PAGE`), not a standalone `$CMS_GLOBAL…$`
    instruction. Property sets can't have bodies/catalogs. Separate schema (DEVELOPER) and content (EDITOR)
    endpoints. New projects bootstrap one more folder.
  - M19: `DATASET` schemas live in a new fixed `datasets` folder in the Templates store; only records live in the
    Content store. The record→dataset link reuses `template_asset_id`. `where=` uses the OCTL `Expr` grammar.
  - M20: one parent per template, stored as `payload.parentTemplateRef`. The effective CDL is computed on read, not
    copied into children. A parent change validates descendants but writes nothing.
  - M21: dataset source lives inside M21.2.1/3.1/4.1 but is not a hard dependency on M19 (nav source ships first).
  - M23: projects are archived, not deleted, so the index is closed on archive. The after-commit hook is new (none
    exists). German + English analyzers. Search is unavailable, not a startup failure, when the index is locked.
  - M24: container editors (`group/list/catalog/pagination`) can't be `localizable`, only leaves can. `required` is
    checked only for the default locale. Locale config is not revision-scoped (like other `Project` columns).
    Missing `{locale}` in a path → `SF-GEN-0111`.
- **Cross-epic coordination notes:** Liquibase changelog numbers, `SF-*` diagnostic numbers and the export
  `protocolVersion` bump are assigned at implementation time. Several epics add them and the order may change.
  The golden-runner stub resolver is needed by both M19.3.2 and M20.1.2; whichever lands first builds it.
- **Spec follow-ups (not tracked as tasks):** §2.2/Q2 (multi-language non-goal reversed), §5.4 column names + `NAV`
  kind, §7.1, §16.2 (new instructions), §18.2/§18.4/§18.6.

---

# Generation targets — per-target output location + management UI — Plan

## Goal
1. Make a target's `config` decide where its output goes, so two projects or two targets
   stop sharing one `{outputRoot}/current` and one build-cleanup pool.
2. Add a Project Settings → **Targets** tab to list, create, edit, delete and set the default target.

## Problems today
- `TargetWriterSelector` ignores `config`; FILESYSTEM/ZIP write to `{outputRoot}/builds/{runId}`
  and `{outputRoot}/current` for *every* project; S3 mirror uses `{outputRoot}/s3/{targetName}`
  (collides across projects with the same target name).
- Nothing in the UI creates targets (only import does), so a fresh project cannot generate
  without calling the REST API by hand.
- `TargetController` allows several `isDefault` targets per project and does no validation.
- `GenerationService.resolveTarget` accepts a `targetId` from another project.

## Design
- Output root per target: `{outputRoot}/{projectKey}/{path}`.
  - `path` = `config.path` (optional), else `target-{id}`.
  - `config.path`: relative, `/`-separated segments of `[A-Za-z0-9._-]`, no `.`/`..`, no
    leading `target-<digits>` segment (reserved for defaults), ≤ 200 chars.
  - Must not equal, contain or sit inside another target's path in the same project.
  - Project keys are already restricted to `[a-z0-9_-]` and never change, so they're safe as a directory name.
- New `TargetLocations` helper (sf-generate `target` package): validates the path and
  resolves the directory (with a final `startsWith(outputRoot)` guard). Used by the selector and the controller.
- `TargetWriterSelector.forTarget(projectKey, target)`; all writers get the per-target root.
- `GenerationTargetView` gains `outputPath` (relative to the server output root, e.g.
  `acme/site`). The absolute server path is never exposed.
- Controller: name required (≤120), path validated + overlap-checked → 400; setting
  `isDefault` clears the other defaults in the project.
- UI keeps any other `config` keys it doesn't show when saving an edit.

## Steps
- [x] 1. Backend `TargetLocations` + unit tests (validation, fallback, overlap, escape guard).
- [x] 2. `TargetWriterSelector` / `S3TargetWriter` use the per-target root; update `GenerationService`
      call sites + project check in `resolveTarget`; update `GenerationServiceTest` mock.
- [x] 3. `TargetController` validation, single default, `outputPath` in view.
- [x] 4. Update integration tests that read `{outputRoot}/builds/...` (Generation, CrossProjectUuidCollision,
      NavigationUrlRegistry, M8NavigationJourney, benchmark if it reads paths); add
      controller API test (create/update/delete, bad path, overlap, single default).
- [x] 5. Regenerate `schema.d.ts` (`npm run generate:api` after server openapi build).
- [x] 6. `GenerationService` (UI): `updateTarget`, `deleteTarget`.
- [x] 7. `ProjectSettingsTargetsComponent` (list/create/edit/delete/default, time-travel read-only),
      route `settings/targets`, tab in shell; spec test.
- [x] 8. Generation page: when no target exists, link to the Targets tab.
- [x] 9. Docs: user guide, ADR-0005/architecture layout note, spec §18.4 layout, infra README.
- [x] 10. Verify: `gradlew test` (affected modules), `npm run build`, `npm test`.

## Review
- **Output layout:** `TargetLocations` (sf-domain) resolves `{outputRoot}/{projectKey}/{config.path | target-{id}}`
  and validates `config.path`. FILESYSTEM, ZIP and S3 writers all use that directory. The layout change is a clean
  break (user decision): existing `{outputRoot}/current` deployments must repoint their web servers, and runs from
  before the change can't be promoted.
- **Controller:** name validation; path validation and overlap check happen before save. An overlap can only happen
  between two configured paths, because `target-<n>` is reserved for the fallback. Saving a default target clears the
  flag on the others (previously two defaults made `findByProjectIdAndDefaultTargetTrue` throw). `outputPath` is now
  in the response.
- **Also fixed:** `resolveTarget` rejects a `targetId` from another project. Import no longer creates a second
  default target.
- **UI:** new Settings → Targets tab (list/create/edit/delete; unknown config keys are kept on edit; read-only in
  time travel). The generation dialog links to it when a project has no targets.
- **Verification:**
  - Unit tests: `TargetLocationsTest` (15) and `GenerationServiceTest` pass.
  - Integration tests: `TargetApiTest` (4), plus the Generation, CrossProjectUuidCollision, NavigationUrlRegistry,
    M8Journey and ExportImport (44) suites, pass.
  - Full backend suite: 173 tests, 1 failure in `ConcurrentWritersTest`. It's flaky: it passes on a clean master
    worktree and twice on this branch.
  - `ng build` (AOT) passes.
  - Ran the app (dev backend + ng serve, Playwright): created, edited and overlap-rejected targets in the UI; a real
    generation wrote `out/demo/site/builds/1`, `current` → 1, and the sitemap used the edited baseUrl. The dialog's
    no-target link goes to the Targets tab.
- **Not verified:** `project-settings-targets.component.spec.ts` could not be run. UI component specs with
  `templateUrl` fail locally (18 files / 68 tests, including existing specs) with `resolveComponentResources`;
  the `@analogjs/vite-plugin-angular` build doesn't match the installed Vite.
- **Follow-ups:** import doesn't check imported `config.path` for overlap; old builds under the legacy shared root are
  not cleaned up.

---

# Follow-ups — import path clashes + legacy output cleanup — Plan

## A. Import: imported `config.path` clashes
- Today import only skips targets whose *name* exists; an imported `config.path` can be invalid or
  overlap an existing target (or another imported target) → shared output folder.
- One planning helper decides, per archived target, in archive order: **skip** (name collision, as today),
  **import as-is**, or **import without `config.path`** (invalid path, or it overlaps an existing/earlier
  imported target) → falls back to `target-{id}`, which can never clash.
- `analyze` and `importSettings` both use that helper so the report always matches what import does.
- New `ConflictType.TARGET_PATH_COLLISION` (WARNING) with message naming the clashing target; UI icon entry.
- Tests: analyze reports it; import stores the target without `path`, other config keys kept; valid
  non-clashing path kept; clash between two imported targets.

## B. Legacy shared-root output cleanup
- Legacy entries directly under `sf.generate.output-root`: `builds/` (numeric dirs, `N.zip`, `N.zip.tmp`),
  `current` (marker file or symlink), `s3/`.
- Project keys can legally be `builds`, `current` or `s3`, so detection is conservative: an entry is legacy
  only if no project (incl. archived) has that key AND its shape matches the old layout
  (`current` is a file/symlink, `builds/` holds only numeric dirs / `N.zip[.tmp]`, `s3/*` holds numeric
  run dirs, `N.keys`, `current`). Anything unexpected is left alone and logged.
- Runs once at startup (ApplicationRunner) after the DB is up; each removal logged at INFO.
- Tests: removes legacy layout; keeps a project folder named `builds`/`s3`/`current`; keeps unrecognized
  content; no-op on empty root.

## Steps
- [x] A1 planning helper + analyze + importSettings + ConflictType + UI icon
- [x] A2 integration tests in ProjectExportImportIntegrationTest
- [x] B1 LegacyOutputCleanup + property gate (per decision)
- [x] B2 tests
- [x] Docs (ADR/infra README note), verify: affected test suites + full backend suite

## Review (follow-ups)
- **Import:** `TargetImportPlan` decides for each archived target: skip on name collision, import, or import
  without `config.path` if the path is invalid or overlaps an existing or earlier-imported target (user decision).
  Conflict analysis and import both use it, so the report always matches what import does. New `TARGET_PATH_COLLISION`
  warning; UI icon added.
- **Cleanup:** `LegacyOutputCleanup` (pure logic) plus `LegacyOutputCleanupRunner` (runs at startup; on by default,
  `sf.generate.cleanup-legacy-output=false` turns it off; user decision). An entry is removed only if no project owns
  the key and its contents match the old layout exactly. Each removal is logged.
- **Verification:**
  - `ProjectExportImportIntegrationTest`: 45/45, including a new clash test.
  - `LegacyOutputCleanupTest`: 5/5.
  - Full backend suite: 328 tests, 0 failures (1 skipped).
  - `ng build` passes.
  - Real boot with a seeded old-layout output root: `builds/`, `current` and `s3/` removed; `acme/site/...` and
    unrelated `notes/` kept.
- **Not covered:** a legacy `current` symlink wasn't tested on Windows (the writer never created symlinks there);
  the symlink branch only deletes the link itself.

---

# Bugfix — generation fails silently, history empty

## Root causes
1. **Failure:** templates written as documented (`$CMS_NAVIGATION(nav:root)$`, docs/navigation-template-syntax.md)
   failed validation with `SF-TPL-0110`. The navigation root's uid is `navigation_root`, and generation/preview
   deliberately reject the uid `root` (the hidden shared folder). Template save used a third resolver with
   no scope check, so the template saved fine.
2. **No error visible:** the live log hid itself as soon as the stream ended; run `diagnostics` were never rendered.
   If a run had already finished when the log subscribed, SSE sent one status frame, never completed, and
   leaked the emitter.
3. **History empty:** `GenerationComponent.load()` was never called; the table only showed runs started since the page opened.
4. **False PARTIAL:** the dialog always offered and pre-checked a hardcoded `markdown` channel, and the store's
   channel list was never loaded.

## Fixes
- [x] `FolderScope.navigationReferenceUid`: `nav:root` → `navigation_root`, used by the generation, preview
      and template-save resolvers; template save also applies the NAVIGATION-scope check.
- [x] SSE: events endpoint checks 404 first, then completes the stream right away for finished runs; emitter
      registration/removal is atomic, and empty lists are dropped.
- [x] UI: history loads on init (plus targets for labels); per-run Details (times, channels, target, revision,
      output, diagnostics); the live log stays open with final status + messages; removed the broken
      "Rollback" (it promoted the failed run itself); Promote is offered for PARTIAL too.
- [x] Dialog loads the project's enabled channels.
- [x] Docs: `nav:root` alias.

## Review
- Tests: `GenerationRendererNavigationTest` (9, including new nav:root test), `GenerationIntegrationTest` (3: nav:root
  saves+generates SUCCESS; nav:pages_root rejected on save), `GenerationEventsApiTest` (fails without fix,
  passes with it), `generation-diagnostics.spec.ts` (3).
- Running app: history shows old FAILED run with Details message; a new failing run keeps the log open with
  `SF-TPL-0110 …`; after removing the broken page, the nav:root template generates SUCCESS with the nav rendered
  and only the html channel.

---

# Bugfix — URL registry race + broken links on nested pages

## Root causes
1. **`null id in UrlRegistryEntry … don't flush the Session after an exception occurs`:** pages render on
   parallel virtual threads, and every page renders the same navigation, so threads race to insert the same
   registry tuple. `computeAndPersist` caught the unique violation from `save` and re-read inside the same
   transaction, but the failed entity stayed in the session (the re-read's auto-flush threw) and the
   transaction was rollback-only. The old race test used mocks, so it could not catch this.
2. **Links broken below the root:** generation emitted root-relative paths without a leading slash
   (`pf/p2.html`), which resolve against the current page's folder. User chose root-absolute links (spec §18.3 form).

## Fixes
- [x] `UrlRegistryRepository.insertIfAbsent` (`INSERT … ON CONFLICT DO NOTHING`) + re-read; no exception on a lost
      race, no poisoned session, no second connection.
- [x] Real concurrent integration test (16 virtual threads, same tuple): failed with the exact user error before,
      passes after (3 reruns). Mock unit test updated to the new contract.
- [x] `GenerationRenderer.siteUrl`: root-absolute hrefs for `$CMS_REF` page/folder/media and nav hrefs
      (registry-backed and folder nodes); already-absolute values unchanged; registry storage unchanged.
- [x] Test expectations updated; `GenerationRendererSiteUrlTest` added; docs/navigation-html-output.md.

## Review
- Running app, pages `p1`, `pf/p2`, `pf/pf1/p3` + nav refs + `nav:root` + `$CMS_REF(page:p1)`: runs SUCCESS
  (also with an empty registry); every page links `/p1.html`, `/pf/p2.html`, `/pf/pf1/p3.html`.
- Not verified on real PostgreSQL (no Docker here); `ON CONFLICT DO NOTHING` is native PostgreSQL syntax and
  works in H2's PostgreSQL mode used by dev/test.

## Correction — relative links (user)
- The user wants links inside a page resolved **relative to the current page**, not root-absolute.
- [x] `GenerationRenderer.relativeUrl(pagePath, sitePath)` replaces `siteUrl`; each page's output path is passed to the
      URL/block/navigation resolvers and section renders. Applies to nav hrefs and `$CMS_REF` page/folder/media.
      Absolute values (`/…`, schemes, `#…`) are unchanged; registry storage unchanged.
- [x] Tests: `GenerationRendererRelativeUrlTest` (4: root, nested, directory targets, absolute/blank),
      a nav render from a nested page (`../../home.html`); root-absolute expectations reverted.
- Running app: `p1`, `pf/p2`, `pf/pf1/p3` all SUCCESS, e.g. p3 links `../../p1.html`, `../p2.html`, `p3.html`;
  a link checker resolved all 12 generated hrefs to existing files.
