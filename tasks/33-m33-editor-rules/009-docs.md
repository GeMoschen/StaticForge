---
id: M33.9
status: done
depends: [M33.1, M33.2, M33.3, M33.4, M33.5, M33.6, M33.7, M33.8]
epic: m33-editor-rules
feature: docs
area: qa
---

# M33.9 — Spec and docs

## Context

`cms-specification.md`, `docs/editors/README.md` (Validation, "When content is validated"), `docs/editors/*.md`,
`docs/template-developer-guide.md` (Part 1 CDL, 2.9 datasets, 2.10 inheritance, 2.12 languages, 2.13 release, 3.2
diagnostics, 3.3 generation), `docs/user-guide.md` (saving, checks, publishing, generate, issues), `docs/api.md`.
Epic decisions 1–14.

## Goals

- Spec: §10.5 rewritten (scopes × levels table, built-in defaults, save/autosave rejection, read-only enforcement),
  §13.3 rule inheritance, §14 new `rules {}` section (grammar, entries, modifiers, message maps), §14.4 built-in
  modifiers and expression language v2 (operators, functions, context, limits, v1 for `visibleWhen`), §14.7 new
  diagnostics, §5.5/§20.2 release (`acceptWarnings`, fills in the release revision), §18.2/§18.5 VALIDATE stage
  (`holdBack`/`fail`, `SF-GEN-0121`, rule findings), planner edge `RULE_REFERENCE`, §19.4/§20.2
  `rules/evaluate`, §23.5 form engine (server-side evaluation, fills, states), §24.5 screens, Appendix B
  (`SF-CDL-0113`–`0119`, `SF-DOM-0156`, `SF-GEN-0121`).
- Template developer guide: a "Rules" chapter with worked examples (cross-field, list rows, page sections, `ref`,
  per-locale, fills, inheritance override/off); user guide: levels, blocked saves, release with warnings; API guide.
- `tasks/todo.md` M33 section closed out with verification evidence and a review.

## Acceptance criteria

- [ ] Spec and guides describe the behavior as built; the fixed ERROR/WARNING-only wording is gone.
- [ ] Full verification: `./gradlew spotlessCheck build test --rerun`, `ng build`, `npx vitest run`, manual check in
      the running app.
