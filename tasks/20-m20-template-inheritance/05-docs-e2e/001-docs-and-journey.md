---
id: M20.5.1
status: todo
depends: [M20.4.1]
epic: m20-template-inheritance
feature: docs-e2e
area: qa
---

# M20.5.1 — Inheritance docs + E2E journey "layout change re-renders every descendant page"

## Context

- `docs/template-developer-guide.md` §2.1 (instruction table) and Part 3 (diagnostic catalogue) are
  the developer references.
- `cms-specification.md` §13, §16.2, §16.9 (EBNF, abridged), §16.11 and Appendix B carry the normative
  text.
- Playwright journeys live in `ui/e2e/` (e.g. `m15-journeys.spec.ts`). Since `M5`, journeys have not
  been run against a live backend here. Check the memory note on running StaticForge locally for the
  dev login and the known-broken UI spec runner.

## Goals

- **Docs:**
  - Template developer guide: a new §2.x "Layouts and inheritance". Cover the `$CMS_EXTENDS`/`$CMS_BLOCK`/`$CMS_PARENT`
    rules, abstract templates, CDL inheritance and name collisions, per-channel semantics, `$CMS_SET`
    outside blocks, and nested blocks. Include a three-level worked example with HTML output.
  - Diagnostic catalogue: 0140–0149 and SF-CDL-0107, plus 0130/0131 now being constants.
  - `cms-specification.md`: §13 (abstract, `parentTemplateRef`), §16.2 table rows, §16.9 EBNF
    productions, §16.11, Appendix B.
  - User guide: an "Abstract" badge note, and why some templates are missing from the page-creation
    picker.
  - `docs/architecture.md` §5: one sentence on chain compilation + `ParentTemplateLoader`.
- **E2E journey** (`ui/e2e/m20-journeys.spec.ts`):
  1. Developer creates abstract `base` with a `content` and a `footer` block, then abstract
     `docs_layout` extending it and overriding `content` with `$CMS_PARENT$`, then `article`
     extending `docs_layout`.
  2. Editor creates a page on `article`. The create dialog doesn't offer `base`/`docs_layout`.
  3. Preview shows all three layers.
  4. Full generation succeeds.
  5. Developer changes `base`'s `footer`, then runs INCREMENTAL generation. The page is rebuilt, and the
     generated file contains the new footer.
  6. Developer tries to add an editor to `base` that collides with one in `article`. The save is
     rejected, and the grandchild is listed.

## Acceptance criteria

- [ ] Guide, spec and user guide updated. Every code in `DiagnosticCodes` added by M20 appears in the
      catalogue with severity and meaning.
- [ ] `m20-journeys.spec.ts` covers steps 1–6 and collects (`npx playwright test --list`).
- [ ] The journey was run against a live dev backend and passed. If it couldn't run in this
      environment, the reason and the manual verification steps performed instead are recorded here
      (as `M15.6.1` did).
- [ ] The M20 epic README exit criteria are ticked, with evidence.

## Out of scope

- Any behavior change. Only docs and tests.

## Notes / hazards

- Keep the guide's instruction table and the spec's EBNF in sync with the parser, not with this
  task's wording. If implementation changed a code number or rule, the code is the source of truth.
