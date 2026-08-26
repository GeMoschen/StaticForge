---
id: M8.2.3
status: done
depends: [M8.2.2, M8.1.4]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.3 — Splice the registry into generation and preview rendering

## Context

`M8.1.4`'s `navigation` instruction currently resolves hrefs directly via
`OutputPathResolver`. This task routes those lookups (and any other place a
`PageReference`'s href is rendered) through `UrlRegistryService` instead, using the
`GENERATED` area during a build and `PREVIEW` during preview rendering — the same
dual-path split `GenerationRenderer`/`PageRenderService` already use for content.

## Goals

- `GenerationRenderer`'s `navigation` `BlockResolver` implementation calls
  `UrlRegistryService.resolve(..., area = GENERATED, ...)` instead of computing the
  href inline.
- Preview's `PageRenderService` implementation calls the same method with
  `area = PREVIEW`.
- Confirm both areas can legitimately hold *different* URLs for the same
  `PageReference`+channel (e.g. preview uses a draft slug, generation uses a published
  one) — this is intentional per the milestone brief's "two distinct areas", not a bug
  to reconcile.
- Add a golden/integration test generating the same project twice with an intervening
  content edit (rename a target page) and asserting the `GENERATED`-area URL is
  unchanged both times, while a fresh preview render reflects the edit only if `PREVIEW`
  was reset or never assigned — pick and document the exact expected behavior here based
  on what `M8.2.2` implements.

## Acceptance criteria

- [x] `./gradlew build` golden tests demonstrate URL stability across two full
      generation runs with content changes in between (no reset).
- [x] Preview rendering uses the `PREVIEW` area exclusively; generation uses `GENERATED`
      exclusively — a shared test proves no cross-area read/write happens.
- [x] `SF-GEN` diagnostics: if `OutputPathResolver` cannot resolve a `PageReference`'s
      target page at all (e.g. dangling target somehow bypassed `M8.1.2` validation),
      the build fails that page with a diagnostic rather than silently emitting a
      broken link — pick a new diagnostic code.

## Out of scope

- REST/UI exposure of the registry (`M8.2.4`, `M8.2.5`).

## Notes / hazards

- `OutputPathResolver` is currently built fresh per generation run from a `Snapshot`
  (`OutputPathResolver.forSnapshot(...)`); the registry's lazy-populate path must still
  call it correctly when it needs to compute a first-time URL during a build — reuse the
  same resolver instance already constructed for that run rather than building a second
  one.

## Implementation record (M8.2.3, done)

**`navHref` signature change (both callers) — the load-bearing change for this task.**
`NavigationTreeJson.toJson`'s href resolver used to be `Function<UUID, String>` keyed on a
node's `resolvedPageUuid`. `UrlRegistryService.resolve` keys on `pageReferenceUuid`, which a
bare resolved-page uuid cannot supply (a `FOLDER` entry-point node's `resolvedPageUuid` comes
from walking a `startNode` chain, not from a `PageReference` the folder owns, so there's no
1:1 mapping back to a `PageReference` uuid from a page uuid alone). Changed the resolver type
to `Function<NavTreeNode, String>` throughout (`NavigationTreeJson.toJson`, both `navHref`
implementations):
- `GenerationRenderer.navHref(NavTreeNode node, String channel)` (was
  `navHref(UUID resolvedPageUuid, String channel)`).
- `PageRenderService.navHref(NavTreeNode node, long projectId, String projectKey, String
  channel, boolean rewriteLinks, String baseUrl)` (was `navHref(UUID resolvedPageUuid, String
  projectKey, String channel, boolean rewriteLinks, String baseUrl)` — also gained a
  `projectId` parameter, threaded down from `renderNavigation`, since `RevisionContext`
  requires one).

Dispatch inside both: `node.type() == AssetType.PAGE_REFERENCE` → resolve via
`UrlRegistryService.resolve(node.assetUuid(), channel, GENERATED|PREVIEW, ctx)` (cached,
stable across edits). Any other node kind (a `FOLDER` entry-point) → unchanged pre-`M8.2.3`
direct resolution (`OutputPathResolver.resolvePageUrl` / the existing page `UrlResolver`) —
the registry only has a `PageReference` identity to key on, so folder-entry hrefs were
deliberately left out of the registry's scope rather than inventing a synthetic key for them.

**`RevisionContext` construction:**
- `GenerationRenderer`: `RevisionContext.of(snapshot.projectId(), generationUserId, "generation")`.
  `generationUserId` is a new constructor parameter threaded from `GenerationService.run`
  (`run.getStartedBy()`) through a new `RenderPipeline.execute(snapshot, plan, paths, Long
  userId)` overload (the two existing narrower `execute` overloads now delegate with
  `userId = null`, preserving every other caller/test unchanged) into
  `GenerationRenderer`'s new 6-arg constructor (the old 4-arg constructor is kept, delegating
  with `urlRegistryService = null, generationUserId = null` — `navHref` falls back to the
  direct pre-`M8.2.3` path whenever `urlRegistryService` is null, so existing tests/call sites
  that don't care about the registry are unaffected).
- `PageRenderService`: `RevisionContext.of(projectId, null, "preview")` — preview has no
  attributable "user" at the render layer (it's a share-token/live-render path, not an
  authenticated mutation), so `userId` is always `null` there; `projectId` is threaded from
  `renderNavigation`'s existing `projectIdOf(...)`-derived context.

**Diagnostic code chosen: `SF-GEN-0411`** (`NavigationDiagnosticCodes.NAV_DANGLING_PAGE_REFERENCE`,
next free number after `SF-GEN-0410`). Fires when `NavigationTreeJson.danglingPageReferences(tree)`
(new method — walks the resolved tree collecting every `PAGE_REFERENCE` node whose
`resolvedPageUuid` is `null`, i.e. a target that's missing/deleted or a `FOLDER` target with no
navigable page anywhere in its subtree — distinct from a legitimate grouping-only `FOLDER` node
with no `startNode`, which is intentional and not an error) finds any dangling reference:
- `GenerationRenderer`: throws `RenderLimitException` carrying the diagnostic — reused
  (documented in its own javadoc as now a general "abort this page's render, carry a
  Diagnostic" vehicle, not exclusively a guard-rail-limit exception) since
  `RenderPipeline.renderEntry` already catches it and reports the diagnostic as a build ERROR
  for just that page, without aborting the whole run.
- `PageRenderService`: throws `SfException` via `ProblemFactory.other(422, ...)` — preview has
  no diagnostics-collection channel (it renders one page synchronously for one HTTP response),
  so this surfaces as a thrown exception, consistent with every other unresolvable-asset
  failure already in this class.

**Cross-area independence:** proven directly by
`NavigationUrlRegistryIntegrationTest.previewAndGeneratedAreasAreResolvedAndCachedIndependently`
(sf-app) — renders preview and generation for the same `PageReference`+channel, overrides one
area, regenerates/re-previews, asserts the other area is untouched. URL stability across content
edits is proven by
`NavigationUrlRegistryIntegrationTest.generatedUrlIsStableAcrossTwoGenerationRunsWithAnInterveningPageRename`
(runs a full generation, renames the target page, runs a second full generation, asserts the
`GENERATED`-area URL is byte-identical both times). Both are real `@SpringBootTest` runs through
`GenerationService` end-to-end (not mocked), timeout-bounded per this codebase's existing
`GenerationIntegrationTest` convention.

**A note on test flakiness observed during this task:** both new `NavigationUrlRegistryIntegrationTest`
tests, plus the pre-existing `GenerationIntegrationTest`, occasionally hit their 60s
"generation did not reach a terminal state" timeout when many `./gradlew` processes run
concurrently on the same machine (as happened during this milestone's multi-agent build
verification) — confirmed not a real regression by re-running each in isolation, where they
pass in ~30s. Not something this task introduced or needs to fix; noted here so a future
flaky-looking failure of these specific tests isn't mistaken for a real regression without
first retrying in isolation.

**Unit-level coverage:** `GenerationRendererNavigationTest` (sf-generate) gained
`danglingPageReferenceFailsRenderWithSfGen0411` and
`navigationHrefsForPageReferenceNodesRouteThroughTheUrlRegistryGeneratedArea` (a fake
in-memory `UrlRegistryService` implementation asserting the `GENERATED` area and exact
`pageReferenceUuid` passed).
