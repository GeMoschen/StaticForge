# Feature: Render safety & content validation

**Spec:** Implements §16.10/§26.3 render limits (`SF-TPL-0130` include depth) and §10.5/§14.4
content validation ("save always succeeds if structurally valid; publish blocks on
`ERROR`-severity validations").

## Goal

Close two gaps that later epics would otherwise build on without knowing:

1. **Include cycles aren't caught.** `OctlRenderer.renderInclude` (~l.151) increments
   `State.includeDepth` and throws `SF-TPL-0130` past `MAX_INCLUDE_DEPTH = 32`. But `render(...)`
   creates a new `State` per call (~l.44), and `GenerationRenderer` / `PageRenderService` render each
   included section through a new `render(...)` call, so the counter restarts at 0 at every level.
   A → B → A recursion most likely ends in a `StackOverflowError`, which `RenderPipeline.renderEntry`
   doesn't catch as a `RenderLimitException`. `SF-TPL-0130`–`0133` are also string literals rather
   than `DiagnosticCodes` constants. `M20` (inheritance chains) adds another recursion path that
   needs the same guard.
2. **Content is never validated server-side.** `ContentValidator.validate(ContentDefinition, JsonNode)`
   (`asset/content/ContentValidator.java`) is complete and tested, but main code never calls it.
   `PageServiceImpl.validatePagePayload` (~l.232) only checks that `templateRef`s point at the right
   template types; §10.5's body `allow` list isn't enforced either. `M17` (globals) and `M19` (records)
   are CDL-only assets and depend on this validation being real.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-include-cycle-guard.md](001-include-cycle-guard.md) | — |
| 2 | [002-server-side-content-validation.md](002-server-side-content-validation.md) | — |

## Feature exit criteria

- [x] An include cycle or excessive nesting fails only the affected file with `SF-TPL-0130`, in both
      generation and preview. The render limit codes are constants.
      *Proof:* `RenderPipelineRenderLimitsTest`, `IncludeCycleGenerationIntegrationTest` (run PARTIAL, other pages published — fixed in M16.6.1), `PreviewRenderLimitsIntegrationTest`, journey 4; codes in `DiagnosticCodes` (cycle = `SF-TPL-0135`).
- [x] Page, section and catalog-card saves reject **structurally** invalid content (422 with
      field-addressed issues). Completeness errors (`required`, `min`) never block a save but block
      publish of the affected page, listed in the generation report, per §10.5.
      *Proof:* `PageContentValidationApiIntegrationTest`, `ContentCompletenessGenerationIntegrationTest`, journey 5.
- [x] The body `allow` list is enforced on section add and move.
      *Proof:* `PageContentValidationApiIntegrationTest` (add + same/cross-page move).

## Dependencies

`M2:octl` (`OctlRenderer`, `BlockResolver`, `RenderLimitException`), `M2:cdl` (`ContentDefinition`,
`ContentValidator`, `ExpressionEvaluator`), `M3:page-editing` (`PageServiceImpl`, `BodyService`,
`PageAutosaveService` UI), `M4:generation` (`RenderPipeline.validate`).
