# ADR-0004 — Two declarative languages (CDL + OCTL) with escaping-by-default rendering

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Tech lead (specced in `cms-specification.md` §14, §16)

## Context

Headless CMS products routinely entangle three things: *what can be edited*, *what the editor typed*, and *how it renders*. The spec requires these to be separated so one content set emits multiple output formats, a template change never invalidates content, and broken references cannot reach production.

## Decision

1. **Two small, purpose-built languages instead of one general one.** CDL (`ContentDefinition`) declares *editors*; OCTL (`CompiledTemplate`) declares *rendering*. Each is a hand-written lexer/parser — `CdlLexer`/`CdlParser`/`CdlCompiler`/`CdlValidator` for CDL, `OctlLexer`/`OctlParser`/`OctlCompiler` for OCTL — over an AST with no ANTLR/runtime dependency. Both return rich `Diagnostic` objects (code, line, column, severity) that Monaco surfaces live.

2. **Text-first, unambiguous delimiters.** An OCTL template is the target format with `$CMS_…$` instructions embedded; `{{`, `<%`, `${}` from other toolchains pass through untouched (§16.1). There is no arbitrary code, reflection, or I/O.

3. **Escaping by default.** Every value is escaped for the channel's `default_escaping` as the final render step unless the filter chain already contains an escaping filter or `raw`. The `Escaping` type and `Filters` registry implement this; `raw` on a plain-text editor is a build warning (`SF-TPL-0301`), not silently allowed.

4. **References resolved to UUIDs at compile time.** `$CMS_REF(assetType:uid)$` and `assetType:uid` accessors are resolved to UUIDs by `ReferenceResolver` during compilation and recorded in `asset_reference`. An unresolvable UID is a compile error (`SF-TPL-0110`), not an empty string.

5. **One render engine for preview and generation.** Preview (`PageRenderService`) and generation (`RenderPipeline`/`GenerationRenderer`) both call `Renderer`/`OctlRenderer` with the same `CompiledTemplate`, so "a preview that renders is a build that renders" (§19.2).

## Consequences

- CDL changes never destroy content: removed editors leave orphaned values preserved under `content._orphaned` (§12.2); the `ContentValidator` re-validates on save/publish.
- The render engine is side-effect free and thread-safe, enabling parallel rendering on virtual threads with guard rails (max include depth 32, max loop iterations 100,000, max 32 MB/output, 5 s/file — `RenderLimitException`, §16.10).
- The `ExpressionEvaluator` grammar is deliberately tiny and mirrored in the Angular form engine, sharing one fixture file so `visibleWhen` behaves identically backend and frontend (§14.4, §23.5).
- Diagnostics are the primary developer UX: `SF-TPL-*` (OCTL), `SF-CDL-*` (CDL), `SF-GEN-*` (generation). See `template.diagnostic.DiagnosticCodes` and `generate.GenerationDiagnosticCodes`.
