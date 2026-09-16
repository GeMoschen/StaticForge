# M16 — Render & reference foundations

**Spec:** Closes gaps between the spec and the code in §5.4 (reference integrity), §14.7 (CDL
compiler), §15.2 (channel settings), §16.4/§16.5 (reference resolution, cross-asset values),
§18.2/§18.3 (incremental planning, output paths), §21.5 (caching). Not part of the original §27
roadmap. It is inserted the same way `M8`–`M15` were: as a foundation refactor that the feature
epics `M17`–`M24` depend on, not as a new user-facing capability.

## Goal

The features planned in `M17`–`M24` (global store, parsable text media, content store, template
inheritance, pagination, build insight, global search, multi-language) all depend on render and
reference machinery that the spec describes but the code does not implement yet, or implements
only partly:

1. **No compiled-template cache.** `GenerationRenderer.compileChannel` and
   `PageRenderService.compileChannel` recompile CDL and OCTL from source on every render, once per
   section instance. §21.5 specifies `compiledTemplates` / `contentDefinitions` caches. Inheritance
   (`M20`) and processed media (`M18`) add more compiles per build.
2. **Cross-asset values render empty.** `OctlRenderer.resolve` records the dependency for
   `$CMS_VALUE(assetType:uid.editor)$` and then returns `MissingNode` ("deferred"). The global
   store (`M17`) and datasets (`M19`) are built on this lookup.
3. **`asset_reference` is only written by generation and never closed.**
   - `ContentReferenceService.materialize` has one caller: `GenerationService.materializeReferences`.
   - Each run inserts new rows with `valid_from_revision = snapshot.revision`, and
     `AssetReference.setValidToRevision` is never called, so duplicates and stale edges build up.
   - `AssetServiceImpl.usages` filters `validToRevision == null`, which matches every row.
     `softDelete` blocks deletion when any row exists, even a stale one.
   - `BuildPlanner.affectedPages` walks all rows regardless of revision.
   - Template OCTL references (`OCTL_INCLUDE`, `OCTL_VALUE`, `OCTL_REF`) are never written.
   - So usages, deletion guards and incremental rebuilds are only as correct as the last full
     generation. Build insight (`M22`) makes these edges visible to users.
4. **Channel settings are not wired into output paths.**
   - `GenerationService.run` hardcodes `OutputPathResolver.forSnapshot(snapshot, "index", false, "DEFAULT")`.
   - `UrlRegistryServiceImpl` mirrors the same tuple (its Javadoc says so).
   - `OutputPathExpander.extensionForChannel` derives the extension from the channel key instead
     of `OutputChannel.fileExtension`.
   - Pagination (`M21`) and locale prefixes (`M24`) extend path resolution and need one real source
     of settings.
5. **Render safety and validation gaps.**
   - `OctlRenderer.render` creates a fresh `State` per call, and `GenerationRenderer.renderSection`
     renders nested includes through a new `render(...)` call. `includeDepth` restarts at 0, so an
     include cycle (A → B → A) likely ends in a `StackOverflowError` instead of `SF-TPL-0130`.
   - `ContentValidator.validate` has no caller in main code, so content is never validated against
     the CDL on save. Globals and records (`M17`, `M19`) are CDL-only assets with no page template
     to catch bad values.

This milestone fixes each gap once, in the shared layer, so the feature epics build on it instead
of adding one-off workarounds.

## Exit criteria (epic is done when)

- [x] Rendering a 5,000-page fixture compiles each (template, channel) at most once per build
      (proven by a counter or spy in a test), and preview reuses compiled templates across requests
      without ever serving a template compiled against stale UID → UUID resolution.
      *Proof:* `RenderPipelineCompileCacheTest` (Micrometer `sf.template.compiles` counter; 50 pages, the per-build
      memo is keyed by (template, channel) so the bound is independent of page count),
      `PreviewCompileCacheIntegrationTest` (UID rename → recompile, never the stale uid).
- [x] `$CMS_VALUE(page:about.headline)$` renders the referenced page's editor value in both
      generation (snapshot-consistent) and preview (live/time-travel revision), with golden tests;
      the dependency is still recorded.
      *Proof:* golden case `render/value-cross-asset/`, `CrossAssetValueIntegrationTest`, M16.6.1 journey 1 (live).
- [x] Saving any asset that has a payload writes that version's outgoing `asset_reference` rows in
      the **same revision and transaction**, and closes the previous version's rows
      (`valid_to_revision`). Saving a template writes its OCTL reference rows. Generation no longer
      inserts reference rows.
      *Proof:* `ReferenceMaterializationIntegrationTest`, `ReferenceMaterializationGuardTest` (ArchUnit),
      `RevisionAwareReferencesIntegrationTest` (two FULL runs insert zero rows), M16.6.1 journey 2 (usages before any
      generation).
- [ ] Usages, the delete guard and `BuildPlanner` only see references valid at the relevant revision;
      duplicate or stale rows from before this epic are cleaned up by a Liquibase changeset.
      *Not ticked:* the readers are proven (`RevisionAwareReferencesIntegrationTest`, journey 2), and
      `015-revision-aware-references.xml` + the startup backfill are proven on H2 only — the changeset has not
      been run against PostgreSQL (no PostgreSQL in this environment).
- [x] Generation, the URL registry and preview resolve output paths from the channel's own
      `settings` (`indexFileName`, `trailingSlash`, `urlStrategy`) and `fileExtension`. No hardcoded
      `("index", false, "DEFAULT")` tuple is left.
      *Proof:* `ChannelOutputSettingsIntegrationTest` (link checker, registry = generation = preview), M16.6.1
      journey 3 (channels UI → `about/index.html`, 0 broken links).
- [x] An include cycle fails the affected file with `SF-TPL-0130` (no `StackOverflowError`), in both
      generation and preview.
      *Proof:* a cycle reports the dedicated `SF-TPL-0135` (`0130` stays the depth limit).
      `PreviewRenderLimitsIntegrationTest` (422), `IncludeCycleGenerationIntegrationTest` (run PARTIAL, only the
      cyclic page held back — fixed in M16.6.1, the run used to be FAILED with nothing published), journey 4.
- [x] Page, section and catalog-card content is validated against its CDL on save; violations
      come back as field-addressed `ContentIssue`s in a `422` problem.
      *Proof:* `PageContentValidationApiIntegrationTest`, `ContentCompletenessGenerationIntegrationTest`, journey 5.
- [x] `./gradlew build` and `ui npm run build` are green. `RevisionInvariantsTest` holds with reference
      rows included in the invariant.
      *Proof:* both green on `m16-foundations` at the M16.6.1 commit (see M16.6.1 notes).

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [compile-cache](01-compile-cache/README.md) | backend | — |
| 2 | [cross-asset-values](02-cross-asset-values/README.md) | backend | — (benefits from 1) |
| 3 | [reference-materialization](03-reference-materialization/README.md) | backend | — |
| 4 | [channel-path-settings](04-channel-path-settings/README.md) | fullstack | — |
| 5 | [render-safety-validation](05-render-safety-validation/README.md) | backend | — |
| 6 | [e2e-verification](06-e2e-verification/README.md) | qa | 1–5 |

Features 1–5 do not depend on each other and can run in parallel. Features 2 and 3 both touch
`GenerationService` and `GenerationRenderer`, so agree on ownership before starting them at the same time.

## Dependencies

- `M2:octl` (`OctlCompiler`, `OctlRenderer`, `RenderContext`, `BlockResolver`)
- `M4:generation` (`GenerationService`, `BuildPlanner`, `RenderPipeline`, `OutputPathResolver`)
- `M5:channels` (`OutputChannel.settings`)
- `M8` (`OutputPathExpander`, `UrlRegistryServiceImpl`, `LiveOutputPathResolver`)
- `M15` (compound revisions: reference writes must join the open batch revision)

## Notes

- Spec §5.4 names reference columns `from_revision_from` / `from_revision_to`. The code uses
  `valid_from_revision` / `valid_to_revision` (`006-asset-references.xml`). Keep the code names and
  fix the spec wording in the docs task (`M16.6.1`).
- Spec §5.4 lists a `NAV` kind that `ReferenceKind` does not have. Navigation edges
  (`PAGE_REFERENCE` → page) are `CONTENT_REF`-shaped today. Decide in `M16.3.1` whether to add `NAV`;
  either way, document it.
- `ReferenceKind.TEMPLATE` exists but is unused. `BuildPlanner`'s Javadoc says page → template edges
  are "structural (not materialized as reference rows)". `M16.3.1` writes them as `TEMPLATE` rows, so
  `BuildPlanner`'s payload indexes (`pagesByTemplate`, `pagesBySection`) can become a fallback instead
  of the only source. `M20.2.2` adds child → parent template edges on top of this.
- Spec §21.5 names Caffeine behind Spring `CacheManager`, but no cache library is on the classpath
  yet. Adding it (version catalog entry) is part of `M16.1.1`.
