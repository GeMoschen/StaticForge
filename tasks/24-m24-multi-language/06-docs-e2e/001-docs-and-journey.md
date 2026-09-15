---
id: M24.6.1
status: todo
depends: [M24.1.2, M24.3.3, M24.4.2, M24.5.1]
epic: m24-multi-language
feature: docs-e2e
area: qa
---

# M24.6.1 — Documentation + multi-language E2E journey + regression pass

## Context

Docs live in `docs/` (`template-developer-guide.md`, `editors/README.md` + per-type files,
`user-guide.md`, `architecture.md`, `navigation-template-syntax.md`, `api.md`). Playwright
journeys live under `ui/e2e/` (`m6-journeys.spec.ts`, `m15-journeys.spec.ts`); like every
journey since M5 they may not be executable here without a seeded backend — record the
execution status honestly (see M15 exit criteria and the `running-staticforge-locally`
memory for dev ports/login).

## Goals

- Docs:
  - `docs/editors/README.md`: `localizable` in common attributes; container rule;
    L10N stored-value shape.
  - `docs/template-developer-guide.md`: `$CMS_META(locale|language)$`, `CMS_LOCALES`
    switcher example, locale-aware `date`/`number`, `$CMS_REF(…, locale=)$`, `{locale}`
    placeholder, new diagnostics (`SF-CDL-0107`, `SF-GEN-0111`).
  - `docs/user-guide.md`: Languages settings tab (URL change warning), editing locale
    switcher, fallback display, missing-translation filter, preview per locale.
  - `docs/architecture.md`: locale dimension (L10N values, plan fan-out, URL registry key).
  - `docs/api.md`: locales + translation-status endpoints, `locale` params.
  - Leave spec §2.2/Q2/§16.2/§18.3/§18.6 edits as the documented follow-up from the epic
    Notes (don't silently rewrite the spec here unless the user asks).
- E2E journey `ui/e2e/m24-journeys.spec.ts`:
  1. Admin enables `de` (default) + `en`, confirms URL change warning.
  2. Developer marks `headline` localizable on a page template.
  3. Editor switches to `en`, sees `de` fallback, translates headline, previews `en`.
  4. Generate; assert `de/…` and `en/…` files exist, `hreflang` in sitemap, language
     switcher links resolve (link check of every href against its page).
  5. Change only the `en` headline; incremental run plans only `en` entries (check the
     M22 plan/reason view).
- Regression pass: run the existing generation, navigation, export/import and revision
  suites against a non-localized project and confirm identical results (reference the
  M24.3.2 golden comparison).

## Acceptance criteria

- [ ] All listed docs updated and cross-linked.
- [ ] `m24-journeys.spec.ts` exists, collects, and has been run against a live backend or
      its non-execution is recorded with the reason.
- [ ] Link check over generated `de`/`en` output reports zero broken links.
- [ ] Regression pass results recorded in this file's Notes.
- [ ] `./gradlew build` green; `npm run build` green; `npm test` status recorded.

## Out of scope

- Updating `cms-specification.md` (epic Notes follow-up).

## Notes / hazards

- Use real rendered examples from the fixture site in the docs (lessons.md: show concrete
  output for output-format behavior).
