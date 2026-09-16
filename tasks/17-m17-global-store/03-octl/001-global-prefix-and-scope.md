---
id: M17.3.1
status: done
depends: [M17.1.2, M16.2.2, M16.3.2]
epic: m17-global-store
feature: octl
area: backend
---

# M17.3.1 — `global:` reference prefix, `CMS_GLOBAL` accessor root, dependency edges

## Context

- **Parsing.** `OctlParser.parseAccessor` accepts any identifier before `:` as the asset
  type.
- **Compile-time mapping.** `OctlCompiler.compile(source, channel, ReferenceResolver, ContentDefinition)`
  resolves `assetType:uid` to UUIDs into `CompiledTemplate.references()` (`SF-TPL-0110`
  when unresolvable). The prefix → `AssetType` mapping is duplicated in three private
  `assetTypeForRef` helpers: `TemplateServiceImpl` (~line 249), `GenerationRenderer`
  (~line 260) and `PageRenderService` (~line 450). `nav` → `FOLDER`; everything else goes
  through `AssetType.valueOf(upper)`. `M16` may already have consolidated them; use
  whatever exists at implementation time.
- **Editor-name check.** `OctlCompiler.checkAccessorRoot` (~line 163) flags an unknown
  root name as `SF-TPL-0103` whenever a `ContentDefinition` is present; only `CMS_PAGE`
  and shadowed names are exempt.
- **Rendering today.** `OctlRenderer.resolve` (~line 325) handles `CMS_PAGE`, then loop
  variables, then `$CMS_SET` variables, then `context.values()`. Asset references return
  `MissingNode` today. After `M16.2`, an `AssetValueResolver` on `RenderContext` renders
  them, with a snapshot implementation in `GenerationRenderer` and a live one in
  `PageRenderService`.
- **Dependencies.** Render dependencies (`RenderResult.dependencies`) become reference
  edges. After `M16.3`, template OCTL references are written on template save, and
  `BuildPlanner.affectedPages` walks revision-aware reverse edges.

## Goals

- **Prefix.** `global` maps to `AssetType.GLOBAL_SET` in the reference resolver(s).
  `global:site` addresses a set by uid; `global:site.title` is the set's `content.title`.
- **Shorthand.** `CMS_GLOBAL.<setUid>.<path…>` is *compile-time sugar* for
  `global:<setUid>.<path…>`:
  - `OctlCompiler` rewrites or treats the accessor as the asset reference, so it's
    resolved (`SF-TPL-0110` when the set is unknown) and appears in
    `CompiledTemplate.references()`.
  - `checkAccessorRoot` exempts `CMS_GLOBAL`.
  - `CMS_GLOBAL` alone, without a set uid, is a compile error: a new diagnostic code or
    `SF-TPL-0110` with a clear message.
- **Resolution.** The `M16.2` `AssetValueResolver` implementations return
  `payload.content` of a `GLOBAL_SET` for the reference root: from the snapshot at the
  run's revision in generation, and from the live, or time-travel revision, asset in
  preview. Paths below it go through the existing `resolveSub`.
- **Everywhere an accessor is accepted.** `$CMS_VALUE`, `$CMS_IF` expressions, `$CMS_FOR`
  sources (list editors in a set), filters on the value, and `$CMS_REF` on media/link
  editors inside a set. `$CMS_REF` must produce a URL relative to the *rendering* page
  (`GenerationRenderer.relativeUrl`), not relative to the set.
- **Dependencies.**
  - A page render that reads a set records the set UUID as a render dependency.
  - Media referenced *through* a set value (e.g. `$CMS_REF(CMS_GLOBAL.site.logo)$`) is a
    dependency of the page, so `AssetCopyStage` copies it (`GenerationService.mediaUuids`).
  - Template save records `OCTL_VALUE` edges template → set (`M16.3.2`), so usages and
    delete protection work before any generation.
- **Incremental.** `BuildPlanner` rebuilds every page with a revision-valid edge to a
  changed `GLOBAL_SET`, whether directly or through its page/section template. Verify
  that the reverse-edge BFS covers a template → set edge (page → template → set) and add
  the hop if it doesn't.
- **Tests.**
  - Golden tests under `server/sf-template/src/test/resources/render/`: `global-value`
    (value, filter chain, `CMS_IF`, `CMS_FOR` over a list editor), with a stub
    `AssetValueResolver`; the runner needs the stub hook from `M16.2`.
  - Compiler unit tests: unknown set → `SF-TPL-0110`; bare `CMS_GLOBAL` → error;
    `CMS_GLOBAL` not flagged as an unknown editor.
  - Integration test: generate with a set, change one value, run `INCREMENTAL`, and assert
    the plan contains exactly the dependent pages and the output contains the new value.
    Preview shows the live value, and time-travel preview shows the old one.

## Acceptance criteria

- [ ] `$CMS_VALUE(global:site.title)$` and `$CMS_VALUE(CMS_GLOBAL.site.title)$` render the
      same value in generation and preview.
- [ ] `$CMS_IF`, `$CMS_FOR`, filters and `$CMS_REF` work on set values, and `$CMS_REF` URLs
      are relative to the rendering page.
- [ ] A template referencing a non-existent set fails to save with `SF-TPL-0110`, with a
      "did you mean" suggestion if the existing diagnostic mechanism supports it.
- [ ] `GET /assets/{setUuid}/usages` lists referencing templates right after template save,
      before any generation, and lists pages after a generation.
- [ ] A soft-deleted set renders empty with a warning, matching §16.4 for soft-deleted
      targets.
- [ ] An `INCREMENTAL` run after a set value change re-renders exactly the dependent pages
      (integration test asserts plan entries).
- [ ] Media used only through a set value is copied to the output.
- [ ] Golden and unit tests green: `./gradlew :server:sf-template:test :server:sf-generate:test :server:sf-domain:test`.

## Out of scope

- Locale-dependent set values (`M24.3.3`).
- Using `CMS_GLOBAL` in a parsable text media file. That's covered by `M18.3.1`, which
  builds on this task's resolver.
- Autocomplete of `CMS_GLOBAL.` in the template editor (there's no Monaco; see `M20.4.1`).

## Notes / hazards

- Keep **one** resolution path. `CMS_GLOBAL` must not get its own `RenderContext` field
  (`globals()`) that duplicates the cross-asset resolver. If it did, dependency recording
  and snapshot pinning would diverge between the two syntaxes.
- The `$CMS_GLOBAL.site.title$` standalone-instruction form from the roadmap decision is
  deliberately **not** implemented: `CMS_PAGE` is an accessor root, not an instruction, and
  `CMS_GLOBAL` mirrors it (see epic Notes).
- A set uid can change (`AssetController` uid change). `UidChangeResult.affectedTemplates`
  (`findUidLiteralReferences`) must find both `global:<uid>` and `CMS_GLOBAL.<uid>`
  literals. Add a test for each spelling.
- Reverse-edge fan-out: a `site` set read by the page template means *every* page rebuilds
  on a title change. That's correct and expected; mention it in the docs (`M17.5.1`) so users
  aren't surprised by a large incremental run.
