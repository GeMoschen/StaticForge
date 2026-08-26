---
id: M8.2.3
status: todo
depends: [M8.2.2, M8.1.4]
epic: m8-navigation-rewrite
feature: url-registry
area: backend
---

# M8.2.3 — Splice the registry into generation and preview rendering

## Context

`M8.1.4`'s `navigation` instruction currently resolves hrefs directly via
`OutputPathResolver`. This task routes those lookups (and any other place a
`PageReference`'s href is rendered) through `UrlRegistryService` instead, using the
`GENERATED` area during a build and `PREVIEW` during preview rendering — the same
dual-path split `GenerationRenderer`/`PageRenderService` already use for content.

## Goals

- `GenerationRenderer`'s `navigation` `BlockResolver` implementation calls
  `UrlRegistryService.resolve(..., area = GENERATED, ...)` instead of computing the
  href inline.
- Preview's `PageRenderService` implementation calls the same method with
  `area = PREVIEW`.
- Confirm both areas can legitimately hold *different* URLs for the same
  `PageReference`+channel (e.g. preview uses a draft slug, generation uses a published
  one) — this is intentional per the milestone brief's "two distinct areas", not a bug
  to reconcile.
- Add a golden/integration test generating the same project twice with an intervening
  content edit (rename a target page) and asserting the `GENERATED`-area URL is
  unchanged both times, while a fresh preview render reflects the edit only if `PREVIEW`
  was reset or never assigned — pick and document the exact expected behavior here based
  on what `M8.2.2` implements.

## Acceptance criteria

- [ ] `./gradlew build` golden tests demonstrate URL stability across two full
      generation runs with content changes in between (no reset).
- [ ] Preview rendering uses the `PREVIEW` area exclusively; generation uses `GENERATED`
      exclusively — a shared test proves no cross-area read/write happens.
- [ ] `SF-GEN` diagnostics: if `OutputPathResolver` cannot resolve a `PageReference`'s
      target page at all (e.g. dangling target somehow bypassed `M8.1.2` validation),
      the build fails that page with a diagnostic rather than silently emitting a
      broken link — pick a new diagnostic code.

## Out of scope

- REST/UI exposure of the registry (`M8.2.4`, `M8.2.5`).

## Notes / hazards

- `OutputPathResolver` is currently built fresh per generation run from a `Snapshot`
  (`OutputPathResolver.forSnapshot(...)`); the registry's lazy-populate path must still
  call it correctly when it needs to compute a first-time URL during a build — reuse the
  same resolver instance already constructed for that run rather than building a second
  one.
