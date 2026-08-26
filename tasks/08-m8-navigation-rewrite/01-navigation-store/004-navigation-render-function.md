---
id: M8.1.4
status: done
depends: [M8.1.3]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.4 — `navigation` OCTL instruction

## Context

Templates need a function to render a navigation subtree, replacing
`$CMS_NAV(structure:uid)$`/`$CMS_NAV_RECURSE(node)$`. Follow the established extension
point: add a method to `BlockResolver` (default no-op), a new instruction token in the
OCTL lexer/parser/AST, and implement the method per render caller.

## Goals

- OCTL grammar addition (extend §16.9's abridged EBNF in this task's PR description, not
  the spec file): `navigation = "NAVIGATION(" , accessor , [ "," , namedArgs ] , ")"`
  where `accessor` is a nav-folder reference (`nav:<uid>` — new `assetRef` kind, add
  `"nav"` alongside `page|media|section_template|page_template|folder`) and `namedArgs`
  supports at least `depth` (int) and `channel` (defaults to the current render
  channel).
- `BlockResolver.renderNavigation(navFolderUuid, args) -> String` (default `""`,
  matching the existing `renderCatalog` pattern) plus a recursion hook
  (`renderNavigationRecurse(node) -> String`, default `""`) for nested-list templates,
  mirroring the old `$CMS_NAV_RECURSE$` ergonomics but against the new tree shape from
  `M8.1.3`.
- Implement `BlockResolver` for this instruction in both `GenerationRenderer`
  (snapshot-backed) and preview's `PageRenderService` (live-repo-backed), each calling
  `NavigationService.tree(...)` and rendering the folder's own per-channel OCTL template
  (navigation folders keep the "renderer template lives on the asset" pattern from the
  old `structure.channelTemplates`, scoped now to `PAGE_REFERENCE`/folder nodes instead
  of the removed `NavNode`).
- Href resolution inside a rendered nav node must go through the URL registry once
  `M8.2` lands — for this task, resolve hrefs via the existing `UrlResolver`/
  `OutputPathResolver` path directly (a straight page-path lookup) so the feature is
  independently testable; `M8.2.3` is where the registry is spliced in.

## Acceptance criteria

- [x] `$CMS_NAVIGATION(nav:main)$` compiles and renders a nested list reflecting the
      tree from `M8.1.3`, with `active`/`trail` marking relative to the page being
      rendered (same semantics as the old §17.2 step 5).
- [x] Golden-file tests cover: flat folder, nested folders, a folder with `null`
      `startNode` rendered as non-linked grouping, and cycle truncation surfacing the
      new diagnostic code from `M8.1.3`.
- [x] Unknown `nav:` uid at compile time raises the existing "unresolvable asset
      reference" diagnostic (`SF-TPL-0110`), reusing `ReferenceResolver`.

## Out of scope

- URL registry integration (`M8.2`).

## Notes / hazards

- Keep the instruction name `NAVIGATION`, not `NAV` — `NAV` is retired with the old
  feature in `M8.1.1` and reusing it risks confusing old golden fixtures/diagnostics
  still referencing `SF-GEN-0410`.

### Resolution notes (M8.1.4 implementation)

**Final OCTL grammar landed:** `$CMS_NAVIGATION(nav:<uid> [, depth=N] [, channel="key"])$` —
a self-closing (leaf) instruction, exactly like `$CMS_INCLUDE`; there is **no**
`$CMS_END_NAVIGATION$` and no separate recursion instruction in the grammar (see the
block-body-vs-template decision below for why). New AST node `OctlNode.Navigation(Accessor,
List<NamedArg>, line, col)` (`server/sf-template/.../octl/OctlNode.java`); parsed in
`OctlParser.parseInstruction`'s `"NAVIGATION"` case identically to `"INCLUDE"`; validated in
`OctlCompiler.validate`'s `OctlNode.Navigation` case, which calls the same
`resolveReference(...)` helper every other asset-ref instruction uses — so an unresolvable
`nav:` uid raises `SF-TPL-0110` for free, no new diagnostic code needed. Rendering dispatch is
`OctlRenderer.renderNavigation`, mirroring `renderInclude`: resolves the compile-time UUID,
adds it to the render's dependency set, and (when a `BlockResolver` is wired) emits
`resolver.renderNavigation(uuid, namedArgs)` verbatim.

**New `assetRef` kind `nav`:** `nav:<uid>` reference resolution required a small addition
beyond `ReferenceResolver` itself (which is already fully generic over the `assetType`
string) — both `GenerationRenderer.referenceResolver()` (sf-generate) and
`PageRenderService.referenceResolver(...)` (sf-domain) previously mapped an accessor's
`assetType` string straight onto `AssetType.valueOf(assetType.toUpperCase())`, which works
for `page/media/folder/section_template/page_template` but has no `NAV` enum constant — a
navigation folder is still plain `AssetType.FOLDER` under the hood (`M8.1.2`). Added a shared
`assetTypeForRef(String)` static helper in each class that special-cases `"nav" ->
AssetType.FOLDER` before falling back to `AssetType.valueOf(...)`. Also added `nav` to the
`page|media|section_template|page_template|folder` UID-literal-reference regex in
`AssetServiceImpl.findUidLiteralReferences` (the "uses of this UID in template source" scan
surfaced on rename) so a nav-folder UID rename now warns about `nav:` references too.

**Block-body-vs-stored-template decision:** Investigated M8.1.2's actual domain model before
deciding (per this task's own Goals text, which assumed a "renderer template lives on the
asset" pattern that turned out not to exist) — `M8.1.2`'s Resolution notes are explicit that
navigation folders gained *only* an optional `startNode` payload field; no
`channelTemplates`-equivalent was added, and M8.1.2 deliberately kept navigation folders as
plain folders with no template-storage concept. Two options were on the table: (a) extend
M8.1.2's payload shape now to add per-channel template storage, or (b) make
`BlockResolver.renderNavigation(navFolderUuid, args) -> String` (a literal, binding signature
from this task's own Goals) return the **complete** rendered markup in one call, with no
template body at all. Went with (b): `renderNavigation` is a leaf/opaque call exactly like
`renderInclude`/`renderBody` — no OCTL block body, no `$CMS_END_NAVIGATION$`, no new
template-storage concept on the folder asset. `GenerationRenderer`/`PageRenderService`
resolve the tree via `NavigationService.tree(...)` and build the nested-list HTML themselves
via two new small, stateless sf-domain classes shared by both callers (avoids duplicating the
active/trail/href logic twice):
  - `com.acme.staticforge.asset.navigation.NavigationTreeJson` — converts a `NavTreeNode` tree
    into the generic `JsonNode` shape `BlockResolver#renderNavigationRecurse` consumes
    (`assetUuid, type, uid, displayName, label, resolvedPageUuid, href, active, trail,
    children[]`), marking `active`/`trail` relative to the page being rendered and resolving
    each entry's href via a caller-supplied `Function<UUID,String>` (the swap-in point below).
    `NavTreeNode` never crosses into `sf-template` directly — `BlockResolver` lives in
    `sf-template`, which must stay free of a `sf-domain` dependency, so this conversion to
    plain `JsonNode` is the one place the boundary gets crossed, mirroring how a CATALOG
    editor's `cards` array reaches `renderCatalog` as plain JSON rather than a typed object.
  - `com.acme.staticforge.asset.navigation.NavigationHtmlRenderer` — the actual markup: nested
    `<ul class="nav"><li class="nav-item[ active][ trail]">…</li></ul>`; a node with no `href`
    (grouping-only folder, no `startNode`) renders as `<span>` rather than `<a>`, never a link.

**Recursion instruction syntax chosen: none.** Rather than a `$CMS_NAVIGATION_RECURSE(node)$`
OCTL token, `BlockResolver.renderNavigationRecurse(JsonNode node) -> String` is a Java-level
extension hook: `NavigationHtmlRenderer.renderChildren(node)` renders one node's children as a
nested `<ul>`, and this exact method body **is** the default `renderNavigationRecurse`
implementation in both `GenerationRenderer` and `PageRenderService`. This was the only design
that fit `renderNavigation`'s literal return-a-complete-`String` signature (a template-body
OCTL block would need either a new "template lives on this instruction's body" AST shape
mirroring `$CMS_FOR$`, which conflicts with `renderNavigation`'s given signature, or a
per-channel template stored on the folder asset, which `M8.1.2` explicitly did not add).
`renderNavigationRecurse` stays a `BlockResolver` method (not a private helper) purely as the
documented, overridable per-node-rendering extension point, matching how `renderCatalog`
exists alongside `renderBody` for the same reason — a future task that wants markup
customization beyond editing `NavigationHtmlRenderer` directly has a seam to override.

**Href resolution swap point for `M8.2.3`:** exactly one small private method per caller,
each calling straight through to the pre-existing page-href machinery (no new URL logic
added):
  - `GenerationRenderer.navHref(UUID resolvedPageUuid, String channel)`
    (`server/sf-generate/.../render/GenerationRenderer.java`) — currently
    `paths.resolvePageUrl(resolvedPageUuid, channel)` (the same `OutputPathResolver` call
    `$CMS_REF(page:...)$`'s own `urlResolver()` "page" branch uses).
  - `PageRenderService.navHref(UUID resolvedPageUuid, String projectKey, String channel,
    boolean rewriteLinks, String baseUrl)` (`server/sf-domain/.../preview/PageRenderService.java`)
    — currently `urlResolver(projectKey, channel, rewriteLinks, baseUrl).resolve("page", null,
    resolvedPageUuid, Map.of())` (the exact `UrlResolver` a `$CMS_REF(page:...)$` would use:
    share-token URL when `rewriteLinks`, raw uuid otherwise).
  `M8.2.3` only needs to change these two method bodies (and the `Function<UUID,String>`
  lambda each passes into `NavigationTreeJson.toJson`) to splice in the URL registry.

**`depth`/`channel` named args:** `depth` parses to an `int` via each caller's private
`parseDepth(Map<String,String>)` (`-1` — unlimited, still hard-capped by
`NavigationService.tree`'s own `PathService.MAX_DEPTH` guard — when absent/unparseable),
passed straight into `NavigationService.tree(navFolderUuid, depth, lookup, diagnostics)`.
`channel` defaults to the render's own current channel (`entry.channel()` /
`RenderContext.channelKey()`, threaded in as `defaultChannel`) when the named arg is absent;
when given, it only affects href resolution (a nav node can link to a page's URL in a
*different* channel than the page currently being rendered).

**Diagnostics propagation:** `GenerationRenderer.renderNavigation` calls
`NavigationService.tree(..., diagnostics)` with the render's own shared `warnings` list (the
same list threaded through `blockResolver(...)` for body/include rendering), so a
`startNode` cycle/depth-cap truncation surfaces `SF-GEN-0410`
(`NavigationDiagnosticCodes.NAV_START_NODE_CYCLE`) into `RenderedFile.diagnostics()` exactly
like any other generation-time warning — proven end-to-end by
`GenerationRendererNavigationTest.startNodeCycleTruncatesAndSurfacesSfGen0410`. Preview's
`PageRenderService.renderNavigation` calls `tree(...)` with a throwaway diagnostics list
instead — `PageRenderService.renderPage` already discards `RenderResult.warnings()` from the
main render entirely (no diagnostics-reporting channel exists in preview's return type today,
`String`), so this keeps parity with the existing behavior rather than inventing a new
reporting path only for navigation.

**Known, accepted gap:** navigation rendered from *inside* a section template's own body (a
`$CMS_NAVIGATION` nested under a `$CMS_BODY`/`$CMS_INCLUDE` section instance) loses the
"active page" identity in preview only — `PageRenderService.renderSectionTemplate` builds its
nested `BlockResolver` from `PageView.contextOnly(pageValues)`, which has no page UUID.
`active`/`trail` marking degrades to "nothing active" in that specific nested-preview case;
top-level page rendering (the common case) and every `GenerationRenderer` path (which already
threads `activePageUuid` through nested section rendering) are unaffected. Flagged here rather
than fixed, since closing it needs threading a `UUID activePageUuid` parameter through
`PageRenderService`'s `renderSectionInstance`/`renderSectionTemplate` chain — a larger,
separable change than this task's scope.

**Verification:** `./gradlew spotlessApply` then `./gradlew build` — full multi-module build
(compile, spotless, all tests, sf-app's Angular bundle) green. New/changed tests:
- `server/sf-template/src/test/java/com/acme/staticforge/template/render/RendererTest.java` —
  `$CMS_NAVIGATION` OCTL wiring: compiles and dispatches to `BlockResolver.renderNavigation`
  with the resolved UUID and named args (`depth`, `channel`), renders empty with no
  `BlockResolver`, and an unresolvable `nav:` ref reports `SF-TPL-0110`.
- `server/sf-domain/src/test/java/com/acme/staticforge/asset/navigation/NavigationHtmlGoldenTest.java`
  — directory-driven golden corpus (`src/test/resources/navigation/render/{01-flat,02-nested,
  03-null-startnode-grouping}`) for `NavigationTreeJson`/`NavigationHtmlRenderer` directly:
  flat folder with active marking, nested folder with trail marking, and a `null`-`startNode`
  grouping folder rendered as a non-linked `<span>` (plus one inline test asserting a
  grouping-only *leaf* with no children still never renders as a link).
- `server/sf-generate/src/test/java/com/acme/staticforge/generate/render/GenerationRendererNavigationTest.java`
  — end-to-end through `GenerationRenderer` against a real in-memory `Snapshot`: flat-folder
  href/active rendering, a nested grouping folder with trail marking, and a self-referential
  `startNode` cycle surfacing `SF-GEN-0410` into `RenderedFile.diagnostics()`.
