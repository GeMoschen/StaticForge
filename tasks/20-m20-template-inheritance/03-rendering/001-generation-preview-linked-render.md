---
id: M20.3.1
status: todo
depends: [M20.1.2, M20.2.1, M16.1.1]
epic: m20-template-inheritance
feature: rendering
area: backend
---

# M20.3.1 — Linked-template rendering in `OctlRenderer`, `GenerationRenderer`, `PageRenderService`

## Context

- `template/render/OctlRenderer.renderNodes` walks a single `CompiledTemplate`. After M20.1.1, a
  `Block` renders its own body and `Parent` renders empty.
- `sf-generate/.../render/GenerationRenderer.compileChannel(template, channel)` reads
  `payload.channelTemplates.<channel>.source` + `contentDefinition` from the **snapshot** and compiles
  them. After `M16.1.1` it goes through `CompiledTemplateCache`.
- `sf-domain/.../preview/PageRenderService` has its own `compileChannel` (~line 185) and block
  resolver (~205–260) over live data or a requested revision.
- `sf-generate/.../render/RenderPipeline.validate` compiles each page template once per
  (template UUID, channel) and collects errors before rendering.
- `templateOf(snapshot, page)` reads `page.payload.templateRef`.

## Goals

- **Renderer:** when a `CompiledTemplate` has a chain (M20.1.2), render the **root** layer's nodes.
  - A `Block(name)` renders the most-derived definition from the block table, keeping a per-render
    "current block depth" stack so `$CMS_PARENT$` renders the next-less-derived definition. At the
    root, `$CMS_PARENT$` renders nothing.
  - Nested blocks: an override of an outer block that doesn't redeclare an inner block still lets the
    inner block resolve through the table. Define and test the rule: an inner block is looked up
    globally by name, not only inside the outer block's winning definition.
  - Child-level `$CMS_SET` outside blocks follows the order pinned in M20.1.2.
  - Output limits (`MAX_OUTPUT_BYTES`) and the loop cap apply to the whole linked render.
- **Generation:** add a snapshot-backed `ParentTemplateLoader` over `Snapshot.byUuid` (a
  `PAGE_TEMPLATE` asset's channel source + own compiled definition).
  - `GenerationRenderer.compileChannel` uses the chain-aware compile via the cache (chain-hash key).
  - `RenderPipeline.validate` reports chain diagnostics (0144/0145/0148/0149, SF-CDL-0107) as
    generation errors for that (template, channel), like any compile error today.
  - An abstract template never gets plan entries, because no page can reference it. Assert this
    rather than special-casing it.
- **Preview:** add a live/revision-backed loader in `PageRenderService`, sharing the "load template
  source + own definition" logic with `TemplateServiceImpl`'s save-time loader (M20.2.1). There
  should be one domain implementation, not three.
- **Dependencies:** render dependencies (`RenderResult.dependencies`) include every ancestor template
  UUID, so per-page references and the incremental plan also see the chain from the render side, as
  a belt-and-braces complement to the `TEMPLATE` edge.
- Golden cases from M20.1.2 pass through the real renderer. Add a sf-generate integration test where
  a three-level chain renders a page with HTML + Markdown channels, identical in generation and in
  `PageRenderService` at the same revision.

## Acceptance criteria

- [ ] Renderer unit tests cover: an override with `$CMS_PARENT$` at depth 1, 2 and 3; a root
      `$CMS_PARENT$` rendering empty; a nested-block override through an un-overridden outer block;
      child `$CMS_SET` visibility.
- [ ] Generation integration test: a page on `article` (→ `docs_layout` → `base`) generates the
      expected HTML and Markdown. Changing only `base` and running INCREMENTAL re-renders that page,
      and its output reflects the new layout.
- [ ] Preview of the same page at the same revision is byte-identical to the generated output (for
      HTML, links rewritten per the preview rules).
- [ ] Time travel: previewing the page at a revision before the parent's last change renders the
      **old** parent layout.
- [ ] A chain error (e.g. parent lacks the channel) fails generation validation with `SF-TPL-0148` for
      that template/channel, visible in the run diagnostics, without crashing the run.
- [ ] `./gradlew build` is green.

## Out of scope

- UI: M20.4.1.
- Section-template inheritance (excluded by decision).

## Notes / hazards

- **Cache correctness is the biggest risk.** A cache hit keyed only on the child's source would
  render a stale parent. The key must be the M20.1.2 chain hash, and computing that hash must not
  require compiling. It is the (uuid, source) list per layer, cheap to gather from the loader.
- `$CMS_INCLUDE` cycle guard (`M16.5.1`): an include inside a block rendered from an ancestor still
  runs under the same shared render state. Verify includes-in-blocks don't reset the depth counter
  (the bug class `M16.5.1` fixes).
- Preview and generation currently duplicate compile logic. Don't add a third copy for chain loading.
  If the shared loader can't live in `sf-template` (which has no repository access), put the
  interface there and the two implementations (snapshot, live) in `sf-generate` and `sf-domain`.
