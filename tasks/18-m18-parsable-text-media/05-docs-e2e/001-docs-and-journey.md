---
id: M18.5.1
status: todo
depends: [M18.3.1, M18.3.2, M18.4.1]
epic: m18-parsable-text-media
feature: docs-e2e
area: qa
---

# M18.5.1 — Documentation + processed-media E2E journey

## Context

User-facing docs live in `docs/user-guide.md`, template developer docs in
`docs/template-developer-guide.md` (instructions table §2.1, diagnostics Part 3), and the spec
in `cms-specification.md` §11 and §16. Playwright journeys live in `ui/e2e/` (e.g.
`m15-journeys.spec.ts`). Journeys since `M5` were collected but not always run against a live
backend. `M15.6.1` records how that gap was handled.

## Goals

- `docs/template-developer-guide.md`: new section "CMS syntax in text media" covering:
  - which MIME types qualify
  - the render context: default channel, escaping `NONE`, available `$CMS_META` keys
    including `mimeType`, the `global:` scope
  - allowed and forbidden instructions
  - the `$$` rule, and escaping advice for JS/JSON (`| js`, `| json`)
  - relative-link behaviour: CSS `url()` resolves against the CSS file; JS runtime URLs
    resolve against the document
  - new diagnostic codes added to Part 3
- `docs/user-guide.md`: media drawer toggle, Source editor, Rendered tab, and "every save is a
  revision".
- `cms-specification.md`: §11.3 payload gains `processCms`, §11.4/§11.5 cover text editing and
  sanitization after rendering, §18.2 ASSETS stage renders processed media, §19.2 preview
  behaviour. Follow the precedent of earlier milestones' doc follow-ups.
- `docs/api.md`: the new media text/validate/rendered endpoints.
- E2E journey `ui/e2e/m18-journeys.spec.ts`:
  1. Upload `site.css` containing `$CMS_VALUE(global:site.brandColor)$`, with a global set
     `site` present (seeded via API).
  2. Enable processing and see no errors.
  3. Edit in the Source tab and save, then check that a revision appears on the spine.
  4. Rendered tab shows the substituted color.
  5. Page preview loads the rendered CSS: assert the computed style of an element.
  6. Run a generation and fetch `assets/media/site.css` from the output, then check the
     rendered content.
  7. Change the global value, run an incremental generation, and check the CSS is updated.

## Acceptance criteria

- [ ] Docs sections above exist, and every new diagnostic code appears in the guide's catalogue.
- [ ] Spec sections updated. No contradictions remain with §11.5's "sanitize SVG on upload"
      wording (now: on upload and after rendering).
- [ ] `m18-journeys.spec.ts` exists and passes against a live dev backend. If it can't be run
      in this environment, the reason is recorded here, with the same rigor as `M15.6.1`.
- [ ] Regression: an existing media-related journey still passes (or is read-through
      verified with the same caveat).
- [ ] All boxes in `tasks/18-m18-parsable-text-media/README.md` Exit criteria are ticked with
      evidence notes.

## Out of scope

- New features discovered while writing docs. Add them as new task files instead.

## Notes / hazards

- The memory note "Running StaticForge locally" describes dev ports, login, and the
  memory-only token navigation trick for Playwright. Use it instead of rediscovering the setup.
- Step 7 depends on how incremental builds carry unchanged files forward (see the hazard in
  `M18.3.1`). If `M22.4.1` hasn't landed, assert only on the re-rendered CSS file, not on the
  completeness of the whole site.
