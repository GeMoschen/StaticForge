# Feature: Rendering (generation + preview of linked templates)

**Spec:** Extends §16.10 (engine), §18.2 (render stage), §19 (preview).

## Goal

Render a page whose template has an ancestor chain, identically in generation (snapshot) and preview
(live or at a revision). Rendering starts at the **root** layout's nodes. Each `$CMS_BLOCK(name)$`
renders its most-derived definition, and `$CMS_PARENT$` inside that definition renders the next
definition up the chain. Editors and bodies resolve against the page's content, as for any
page template, because the effective definition makes inherited editors ordinary editors.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-generation-preview-linked-render.md](001-generation-preview-linked-render.md) | `M20.1.2`, `M20.2.1`; `M16.1.1` |

## Feature exit criteria

- [x] `OctlRenderer` walks the block table and renders `$CMS_PARENT$` correctly at every depth.
- [x] `GenerationRenderer` and `PageRenderService` compile page templates chain-aware, from the snapshot
      or live data, through the compile cache, and produce identical output for the same revision.
- [x] `RenderPipeline.validate` reports chain errors per (template, channel) before rendering.

## Dependencies

`M20.1.2`, `M20.2.1`, `M16.1.1` (compile cache keyed on chain hash).
