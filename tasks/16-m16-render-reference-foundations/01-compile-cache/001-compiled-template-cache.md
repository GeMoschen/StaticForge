---
id: M16.1.1
status: done
depends: []
epic: m16-render-reference-foundations
feature: compile-cache
area: backend
---

# M16.1.1 — `CompiledTemplateCache` for OCTL + CDL, used by generation and preview

## Context

These compile from source on every call:
- `server/sf-generate/src/main/java/com/acme/staticforge/generate/render/GenerationRenderer.java`:
  `compileChannel(SnapshotAsset template, String channel)` (~l.213), called from `render` (~l.123)
  and `renderSection` (~l.573). It reads `payload.contentDefinition` (CDL) and
  `payload.channelTemplates.<channel>.source` (OCTL).
- `server/sf-domain/src/main/java/com/acme/staticforge/preview/PageRenderService.java`:
  `compileChannel(JsonNode, channel, projectId)` (~l.185), called from ~l.182 and ~l.394.

`OctlCompiler.compile(source, channelKey, ReferenceResolver, ContentDefinition)` runs lex → parse →
validate. Validate resolves `assetType:uid` references into `CompiledTemplate.references()`
(`Map<referenceKey, UUID>`). `TemplateServiceImpl.compileChannel` (~l.214) compiles on save and stores
`compiledHash`. Spec §21.5 specifies Caffeine caches keyed by `(assetUuid, revision, channel)`; the
build has no cache library yet.

## Goals

- Add a `CompiledTemplateCache`. Its compile entry point takes the template UUID, the template
  version's revision, the channel, the source and the resolver context, and returns an
  `OctlResult` + `ContentDefinition` pair. Put it in the module both callers can reach (sf-domain
  or a sf-template interface with a sf-domain implementation), respecting `checkModuleLayers`.
- Use two tiers so resolution stays correct:
  - **Per-build memo:** a map scoped to one `GenerationService` run or `Snapshot`, keyed by
    `(templateUuid, channel)`. It is always safe, because the snapshot pins every UID → UUID mapping.
  - **Cross-request cache (Caffeine):** used by preview. Key it so a UID rename or deletion of a
    referenced asset can never return stale references. Recommended: key on
    `(projectId, templateUuid, templateValidFromRevision, channel)` and validate the entry on hit by
    re-resolving the `references()` keys against the current `ReferenceResolver`. If any key maps to
    a different UUID (or none), recompile. Re-resolving N keys is far cheaper than lex + parse +
    validate. Document the chosen strategy in the class Javadoc.
- Cache the CDL `ContentDefinition` the same way, keyed `(templateUuid, templateValidFromRevision)`
  (spec §21.5 `contentDefinitions`). Its compile has no resolver dependency.
- Add Caffeine to `gradle/libs.versions.toml`. Size and idle eviction come from `application.yml`
  (`sf.cache.compiled-templates.max-size` default 2000, `idle` default 30m), matching §21.5.
- Switch `GenerationRenderer` and `PageRenderService` to the cache. `TemplateServiceImpl` keeps
  compiling on save uncached, since that is authoring-time validation.
- Add a compile counter (Micrometer or a test hook) so tests can assert how many compiles happened.

## Acceptance criteria

- [x] Generation integration test with 50 pages sharing 1 page template and 2 section templates on
      one channel: exactly 3 OCTL compiles and 3 CDL compiles per run.
- [x] Preview test: two consecutive renders of the same page → 1 compile. Editing the template
      (new version) → recompile. Renaming the UID of an asset referenced by `$CMS_REF(page:x)$` →
      the next render does not use the stale mapping.
- [x] Time-travel preview at revision N uses the template version valid at N, never a newer
      cached one.
- [x] Existing suites stay green: `GenerationRendererNavigationTest`,
      `GenerationRendererRelativeUrlTest`, `GenerationIntegrationTest`, the preview tests, and
      `GoldenFileRenderTest` (unaffected, since it compiles directly).
- [x] `./gradlew :server:sf-generate:test :server:sf-domain:test` green; `checkModuleLayers` green.

## Out of scope

- Caching rendered output. Only compilation is cached.
- The `navigationTrees` / `projectAuth` / `mediaThumbnails` caches from §21.5.
- Inheritance-linked compilation (`M20.1.2`), which will plug its parent-chain resolution into
  this cache.

## Notes / hazards

- `RenderPipeline` renders on virtual threads in parallel. The per-build memo must be thread-safe
  (`ConcurrentHashMap.computeIfAbsent`), and must not hold a lock while compiling a *different* key.
  `computeIfAbsent` on one map is fine because compiles don't recurse into the same map.
- `SnapshotAsset` may not expose the version's `validFromRevision`. If not, add it, or key the
  per-build memo on `(templateUuid, channel)` only, which the snapshot makes safe anyway.
- Never share a `CompiledTemplate` between projects. Resolution runs against one project's assets
  (see `M9`), so include `projectId` in every cross-request key.

### Implementation notes

- New in sf-domain `asset/template`: `CompiledTemplateCache` (Spring `@Component`, Caffeine), `TemplateCompileMemo`
  (per-build tier, `ConcurrentHashMap.computeIfAbsent`), `CompiledChannel` (OctlResult + ContentDefinition) and the
  package-private `MeteredTemplateCompiler`, which counts real compiles in the Micrometer counter
  `sf.template.compiles{kind=cdl|octl}` (the test hook). Caffeine added as `libs.caffeine` (BOM-managed version) to
  sf-domain only; `sf.cache.compiled-templates.max-size` / `idle` in `application.yml` (defaults 2000 / 30m).
- Per-build tier: keyed `(templateUuid, channel)` (CDL: `templateUuid`). `CompiledTemplateCache.buildMemo(snapshot)`
  keeps one memo per snapshot *object* in a weak-keyed (identity) Caffeine cache, so `GenerationService`'s validate
  call, `RenderPipeline.execute`'s own validate pass and the parallel render all share it without changing the
  `RenderPipeline.validate/execute` signatures; it is released with the snapshot. `SnapshotAsset` was not extended.
  `RenderPipeline` gets the cache injected; `GenerationRenderer` has a new 7-arg constructor taking the memo (the
  existing 4/6-arg constructors, used by tests, create a private memo).
- Cross-request tier (preview): CDL keyed `(projectId, templateUuid, validFromRevision)`, OCTL keyed
  `(projectId, templateUuid, validFromRevision, channel)`. The compile runs with a recording `ReferenceResolver` that
  stores every `(assetType, uid) → UUID|unresolved` lookup; each hit re-resolves them and recompiles on any
  difference — this also catches a previously unresolvable reference that now resolves, not only renames/deletes.
  Strategy documented in the class Javadoc. Concurrent misses may compile twice (last write wins).
- Preview behaviour fix required by the time-travel criterion: `PageRenderService` previously rendered time-travel
  previews with the *current* page/section templates; it now loads template versions valid at the requested revision
  (`templateAt`), threading `revision` through the block resolver alongside the render budget.
- `TemplateServiceImpl` still compiles uncached on save.
- Tests: `CompiledTemplateCacheTest` (sf-domain, 7), `RenderPipelineCompileCacheTest` (sf-generate: 50 pages, 1 page
  template with a body of 3 instances of 2 section templates; validate + execute → exactly 3 OCTL and 3 CDL compiles;
  a new snapshot compiles again), `PreviewCompileCacheIntegrationTest` (sf-app: 2 renders → 1 compile, channel edit →
  recompile, time travel renders the old version, UID rename of a `$CMS_REF(page:x)$` target → recompiled, renders
  unresolved instead of the stale uid).
