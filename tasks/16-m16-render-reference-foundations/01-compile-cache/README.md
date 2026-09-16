# Feature: Compile cache

**Spec:** Implements §21.5 (`compiledTemplates`, `contentDefinitions`) and §14.7/§16.10 (compiler
output is immutable and cacheable).

## Goal

Stop recompiling CDL and OCTL on every render. Today `GenerationRenderer.compileChannel(SnapshotAsset, channel)`
runs for the page template of every plan entry and again for every section instance
(`renderSection` → `compileChannel`). `PageRenderService.compileChannel(JsonNode, channel, projectId)`
does the same on every preview request. The compile hash (`CompiledTemplate.hash()`,
`channelTemplates.<ch>.compiledHash` in the template payload) is computed and stored, but nothing
reads it.

The cache must stay correct: OCTL compilation resolves `assetType:uid` → UUID via a
`ReferenceResolver`, which depends on **project state** (a renamed or deleted target), not only on
the template source. A key built from the source alone would serve stale references.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-compiled-template-cache.md](001-compiled-template-cache.md) | — |

## Feature exit criteria

- [x] One shared cache component is used by generation and preview. Neither calls `OctlCompiler`
      or `CdlCompiler` directly for rendering anymore.
      *Proof:* `CompiledTemplateCache` used by `GenerationRenderer`/`RenderPipeline` and `PageRenderService`; grep finds no `OctlCompiler`/`CdlCompiler` call in `sf-generate` main or `preview`.
- [x] Within one generation run, each (template, channel) compiles at most once. Across preview
      requests, a compiled template is reused until the template or any reference it resolved changes.
      *Proof:* `RenderPipelineCompileCacheTest`, `PreviewCompileCacheIntegrationTest`.
- [x] Every correctness case has a test: UID rename of a referenced asset, template edit, channel
      source edit, and time-travel preview at an older revision.
      *Proof:* `PreviewCompileCacheIntegrationTest` (UID rename, template/channel edit, time travel), `CompiledTemplateCacheTest`.

## Dependencies

`M2:octl` (`OctlCompiler`, `CompiledTemplate`, `CdlCompiler`, `ContentDefinition`), `M4:generation`
(`GenerationRenderer`), `M3:preview` (`PageRenderService`).
