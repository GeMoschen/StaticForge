---
id: M16.2.1
status: todo
depends: []
epic: m16-render-reference-foundations
feature: cross-asset-values
area: backend
---

# M16.2.1 — `AssetValueResolver` SPI in `RenderContext` + renderer wiring

## Context

The pieces involved:
- `Accessor(String assetType, String uid, List<String> path)` (`template/octl/Accessor.java`) already
  parses `page:about.headline` into `assetType="page"`, `uid="about"`, `path=["headline"]`.
- `CompiledTemplate.references()` maps `accessor.referenceKey()` to the UUID resolved at compile time.
- `OctlRenderer.resolve` (~l.325) short-circuits every asset-reference accessor to `MissingNode`.
- `RenderContext` (`template/render/RenderContext.java`) holds channel, escaping, values, meta,
  pageValues, `UrlResolver` and `BlockResolver`, and has no value-lookup hook.

## Goals

- Add `template/render/AssetValueResolver`, a functional interface in sf-template with no
  repository dependencies:
  `JsonNode valueOf(String assetType, UUID uuid)`. It returns the **root value object** of the target
  asset for OCTL navigation, or `MissingNode` when the asset is missing or deleted. The renderer then
  walks `accessor.path()` over the returned node using the existing `resolveSub` logic, so dotted
  paths, list indexes and loop semantics behave exactly like local values.
- Add `RenderContext.Builder.assetValueResolver(AssetValueResolver)` and the
  `RenderContext.assetValueResolver()` accessor (nullable).
- Change `OctlRenderer.resolve`: when `accessor.isAssetReference()`, call
  `noteReference(accessor, s)` (unchanged), look up the UUID in `s.template.references()`, and if a
  resolver exists and the UUID is non-null, return `resolveSub(resolver.valueOf(type, uuid), path, 0, s)`.
  Otherwise return `MissingNode` as today. Leave the `nav:` branch of `resolveForList` as it is.
- Define the "root value object" contract per asset type in the Javadoc. Implementations follow it
  in `M16.2.2`:
  - `page` → `payload.content`, with `bodies` not exposed.
  - `media` → a flat object `{altText, caption, copyright, fileName, mimeType, width, height, …}`.
  - `page_reference` → `{label, …}`.
  - Template and folder types → `MissingNode`. Only `displayName`/`uid` are exposed, via a reserved
    `_meta` sub-object: `page:about._meta.displayName`.
- Add `SF-TPL-0111` (warning, `DiagnosticCodes` constant): a cross-asset value accessor with an empty
  path (`$CMS_VALUE(page:about)$`). It is emitted at compile time in `OctlCompiler.validate` (~l.164),
  because such a value always stringifies to nothing useful.

## Acceptance criteria

- [ ] Unit tests in sf-template with a stub `AssetValueResolver` cover: scalar editor value, nested
      path, list iteration via `$CMS_FOR(link : page:about.links)$`, `$CMS_IF(page:about.flag)$`, a
      missing asset (renders empty) and filters on the value (`| upper`).
- [ ] The dependency set still contains the target UUID in every case, including when the resolver
      returns `MissingNode`.
- [ ] Rendering with no resolver matches today's output byte-for-byte. The existing golden suites
      (`GoldenFileRenderTest`, `MarkdownChannelGoldenTest`) pass unchanged.
- [ ] New golden directory `render/value-cross-asset/` (template + content + a
      `references.json`/stub fixture) is picked up by the runner. Extend `GoldenFileRenderTest` so
      it can supply a stub resolver from a fixture file.
- [ ] `SF-TPL-0111` is emitted for a path-less cross-asset value and is documented in
      `DiagnosticCodes`.

## Out of scope

- Real generation and preview implementations (`M16.2.2`).
- `global:`, `dataset:` and `record:` prefixes (`M17.3.1`, `M19.3.2`). They plug into this interface.
- Localized value unwrapping (`M24.3.1`).

## Notes / hazards

- Escaping: a cross-asset rich-text value is still escaped by the channel default unless `raw` is
  used. This is the same safety rule as local values; don't special-case it.
- `resolveSub`'s current signature takes the path offset. Reuse it rather than duplicating the path
  walk, so loop-variable and `_index` semantics can't drift.
- Only depend on `UUID`/`JsonNode` in sf-template. `AssetType` lives in sf-domain and must not leak
  in (ADR-0001), which is why the asset type is passed as the accessor's string.
