---
id: M32.9
status: done
depends: [M32.1, M32.2, M32.3, M32.4, M32.5, M32.6, M32.7, M32.8]
epic: m32-complete-url-registry
feature: docs
area: qa
---

# M32.9 — Spec and docs

## Context

`cms-specification.md`, `docs/api.md`, `docs/user-guide.md`, `docs/template-developer-guide.md`. Epic decisions 1–12.

## Goals

- Spec: URL registry for every target and as the authority on output paths (§15, §18.3), `$CMS_REF` and navigation
  through the registry (§16.4, §17.2), pagination rows (§21), preview per locale (§19.2), planner edge
  `URL_CHANGED` and redirects after override/reset (§18.2, §18.9 — rewrite the "URL registry and redirects"
  paragraph), REST (§20.2), UI (§24), export protocol 11 and import modes (§26.5), codes `SF-DOM-0200`/`SF-DOM-0201`
  (Appendix B).
- API, user and template developer guides.
- `tasks/todo.md` M32 section closed out with verification evidence and a review.

## Acceptance criteria

- [x] Spec and guides describe the behavior as built; no reference to page-reference-only rows left.
- [x] Full verification: `./gradlew spotlessCheck build test --rerun`, `ng build`, `npx vitest run`, manual check in
      the running app.
