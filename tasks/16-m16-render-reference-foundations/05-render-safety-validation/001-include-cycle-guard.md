---
id: M16.5.1
status: done
depends: []
epic: m16-render-reference-foundations
feature: render-safety-validation
area: backend
---

# M16.5.1 — Include cycle guard across nested renders + render-limit diagnostic constants

## Context

- `server/sf-template/src/main/java/com/acme/staticforge/template/render/OctlRenderer.java`:
  - `render(CompiledTemplate, RenderContext)` builds `new State(template, context)` (~l.44).
  - `State` holds `includeDepth`, `loopIterations`, the output byte count and the time budget (~l.600–619).
  - `renderInclude` (~l.151) delegates to `BlockResolver.renderInclude(uid, args)`.
- The resolvers (`GenerationRenderer.blockResolver(...)` → `renderSection(...)`, and the equivalent
  in `PageRenderService`) call `renderer.render(...)` again, so each nested level starts with a fresh
  `State`. `renderBody` / `renderCatalog` recurse the same way (catalog cards can contain catalogs,
  per `docs/editors/catalog.md`).
- Codes `SF-TPL-0130` (include depth), `0131` (loop iterations), `0132` (output size) and `0133`
  (time budget) are literals in `OctlRenderer`. `DiagnosticCodes` doesn't define them.
- `RenderPipeline.renderEntry` catches `RenderLimitException` and fails only that file.

## Goals

- Carry render budget state across nested renders. Recommended: add a `RenderBudget` (sf-template,
  mutable, one per top-level render). It holds include depth, a stack of the template UUIDs
  currently being rendered, the loop iteration count, output bytes and the deadline. Pass it through
  `RenderContext` (`RenderContext.Builder.budget(...)`). Nested contexts built by resolvers reuse the
  parent's budget, and `OctlRenderer.render` uses it when present and creates one otherwise.
- **Cycle detection:** before rendering an include, body section or catalog card, check whether the
  template UUID is already on the budget's stack. If it is, throw
  `RenderLimitException(SF-TPL-0135 "Include cycle: a → b → a")` with the chain in the message. Keep
  `SF-TPL-0130` for depth > 32 on non-cyclic chains.
- Aggregate limits: loop iterations, output bytes and the time budget apply to the whole page
  render, not per nested template. This is a behavior tightening; document it.
- Move `0130`–`0133` into `DiagnosticCodes` constants (`OCTL_INCLUDE_DEPTH`, `OCTL_LOOP_LIMIT`,
  `OCTL_OUTPUT_LIMIT`, `OCTL_TIME_BUDGET`) plus the new `OCTL_INCLUDE_CYCLE = "SF-TPL-0135"`, and list
  them in `docs/template-developer-guide.md` §3.1.
- Cheap compile-time hint: `TemplateServiceImpl` save warns (not errors) when a section template
  includes itself directly (`$CMS_INCLUDE(section_template:<own uid>)$`).

## Acceptance criteria

- [x] Generation test: section template A includes B, and B includes A. The page fails with
      `SF-TPL-0135` in the run diagnostics, the other pages render, and no `StackOverflowError` occurs.
- [x] The same case in preview returns a problem with `SF-TPL-0135`, not a 500.
- [x] A catalog card whose section template contains a catalog that selects the same template
      → `SF-TPL-0135`.
- [x] A 33-level non-cyclic include chain → `SF-TPL-0130`.
- [x] A loop-iteration test spanning nested includes hits `SF-TPL-0131` at the aggregate limit.
- [x] Constants exist and the guide table is updated. `./gradlew :server:sf-template:test :server:sf-generate:test` green.

## Out of scope

- Inheritance chain cycles (`M20.1.2` detects those at compile time, reusing the diagnostic style).

## Notes / hazards

- `RenderContext`'s Javadoc says it is "immutable once built; never shared across concurrent renders".
  The budget is mutable, but it belongs to a single top-level render and its nested renders, which
  run on the same thread. Document that it must never be shared across `RenderPipeline` entries.
- Aggregating the time budget across nesting may make large pages that pass today fail. Run the
  5,000-page benchmark fixture before and after, and compare.

### Implementation notes

- `RenderBudget` (sf-template) holds the nesting stack (template UUID + label), aggregate loop count, aggregate
  output chars and the deadline. Pipelines guard every nested render with `budget.withTemplate(uuid, uid, render)`
  (push/check/pop in `finally`) and pass the budget via `RenderContext.Builder.budget`; `OctlRenderer.render` uses the
  context's budget or a fresh one. The single funnels are `GenerationRenderer.render`/`renderSection` and
  `PageRenderService.renderPage`/`renderSectionTemplate`, so includes, body sections and catalog cards are all covered.
- The page template is the first stack entry; `SF-TPL-0130` fires when a 33rd level would be pushed *below* it (same
  "32 nested includes" allowance as before, now also counting body sections and catalog cards). The cycle check runs
  before the depth check. Message: `Include cycle: a → b → a` (chain from the first occurrence).
- `OctlRenderer` no longer keeps `includeDepth`; resolver output is appended via `State.appendResolved`, which charges
  only output the nested renders did not already charge, so nested output is counted once.
- Behavior tightening (accepted): loop iterations, output size and the 5 s time budget now apply to the whole page.
  The same template included twice side by side is not a cycle.
- Preview: `PageRenderService` public entry points translate `RenderLimitException` into a `422` problem with the
  diagnostic's code/message (was an unhandled exception → 500 / `StackOverflowError`).
- Generation: a limit fails that file (outcome `errors`) and other pages still render; as before for every
  `RenderLimitException`, a non-empty error list makes `GenerationService` mark the run `FAILED` with those diagnostics.
- Tests: `RenderBudgetTest` (sf-template, 7), `RenderPipelineRenderLimitsTest` (sf-generate, 4: cycle, catalog
  self-cycle, 32 vs 33 levels, aggregate loops), `PreviewRenderLimitsIntegrationTest` (sf-app: page + section preview).
- **Deviation — save-time self-include hint not implemented.** Template save has no warning channel (existing
  warnings such as `SF-TPL-0310` are discarded on save; only errors reach the client), and the template save paths are
  being reworked by `M16.3.2` (OCTL reference rows on save), which computes exactly the outgoing include edges a
  self-edge check needs. The runtime `SF-TPL-0135` guard is authoritative; the hint belongs with `M16.3.2`.
- Benchmark not re-run: `GenerationBenchmark`'s fixture has no sections/includes (one flat page template), so the
  aggregated budget cannot change its per-page limits; timings on this shared machine would be noise anyway.
