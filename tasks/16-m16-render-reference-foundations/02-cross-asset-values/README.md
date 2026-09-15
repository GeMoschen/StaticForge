# Feature: Cross-asset values

**Spec:** Implements §16.2 `$CMS_VALUE(assetType:uid.editorName)$` and §16.4 (reference resolution),
which have so far been specified but rendered empty.

## Goal

Make the cross-asset lookup syntax actually return values. Today
`server/sf-template/src/main/java/com/acme/staticforge/template/render/OctlRenderer.java#resolve`
(~l.325) records the dependency (`noteReference`) and then returns `MissingNode.getInstance()`
("Cross-asset value rendering requires the generation snapshot; deferred."). Every consumer of
`resolve` inherits this: `$CMS_VALUE`, `$CMS_IF`, `$CMS_SET` and `$CMS_FOR` over non-`nav:` accessors
(`resolveForList` ~l.281).

The design mirrors the existing `UrlResolver` / `BlockResolver` split. sf-template defines a pure SPI
and never touches repositories. Generation implements it over the `Snapshot`; preview implements it
over live or time-travel versions.

`M17` (`global:`), `M19` (`dataset:` / `record:`) and `M24` (localized values) all plug into this
SPI rather than adding their own lookup paths.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-asset-value-resolver-spi.md](001-asset-value-resolver-spi.md) | — |
| 2 | [002-generation-preview-value-resolvers.md](002-generation-preview-value-resolvers.md) | 1 |

## Feature exit criteria

- [x] `RenderContext` carries an optional `AssetValueResolver`. `OctlRenderer.resolve` uses it for
      asset-reference accessors and still records the dependency.
      *Proof:* `CrossAssetValueRenderTest`, dependency asserted.
- [x] Generation and preview both provide implementations. `$CMS_VALUE(page:uid.editor)$`,
      `$CMS_VALUE(media:uid.altText)$`, `$CMS_IF(page:uid.flag)$` and `$CMS_FOR(x : page:uid.links)$`
      render real data, covered by golden tests.
      *Proof:* golden `render/value-cross-asset/` (page value, `media:logo.altText`, `$CMS_IF`, `$CMS_FOR`), `GenerationRendererCrossAssetValueTest`, `CrossAssetValueIntegrationTest`, journey 1.
- [x] Without a resolver (e.g. `GoldenFileRenderTest`'s null context), behavior is unchanged: empty
      output, dependency recorded.
      *Proof:* `GoldenFileRenderTest` cases without `references.json`, `CrossAssetValueRenderTest`.

## Dependencies

`M2:octl` (`Accessor`, `OctlRenderer`, `RenderContext`), `M4:generation` (`Snapshot`,
`GenerationRenderer`), `M3:preview` (`PageRenderService`).
