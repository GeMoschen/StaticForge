# M3 — Editing UI

**Spec:** §10 (page), §11 (media), §19 (preview), §23 (frontend impl), §24 (UI/UX, core
screens). Roadmap M3 (§27): 4 weeks.

## Goal

Build the editing experience: auth UI, project context/dashboard, the CDL-driven dynamic
form engine, the page tree + page editor (split view, sections, autosave), the media
library with upload/variants, and preview (live/saved, sandboxed iframe).

## Exit criteria (epic is done when)

- [ ] Playwright journeys 1–3 (§25.6) pass. _(specs in `ui/e2e/m3-journeys.spec.ts`; blocked on demo seed — see below)_
- [x] The form engine renders every CDL editor type (§14.3) and autosaves debounced.
- [x] Media upload → variant generation → reference in a section → preview works end to end.

## Implementation status

All 17 tasks implemented. Frontend (`ng build`) green, 49 unit tests green, backend
(`:server:sf-domain:test`, `:server:sf-api:test`) green. OpenAPI regenerated. Three
pre-existing preview-backend compile bugs fixed (PageRenderService call-site arity,
PreviewTokenService IOException catch, PreviewController missing HttpHeaders constants).

**Blocker for the remaining exit criterion:** the demo/test fixtures are still placeholders
(`db/changelog/data/demo-project.xml`, `test-fixtures.xml`) — M1 deferred seeding and never
filled it. The journeys need a seeded demo user/project; until that seed exists they are
gated behind `SF_RUN_E2E=1` in `ui/e2e/m3-journeys.spec.ts`.


## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [auth-ui](01-auth-ui/README.md) | frontend | — |
| 2 | [project-context](02-project-context/README.md) | frontend | 1 |
| 3 | [form-engine](03-form-engine/README.md) | frontend | 2 |
| 4 | [pages](04-pages/README.md) | frontend | 3 |
| 5 | [media](05-media/README.md) | backend+frontend | 3 |
| 6 | [preview](06-preview/README.md) | backend+frontend | 4, 5 |

## Dependencies

`M1` (auth API, asset/page/folder API), `M2` (CDL + OCTL + renderer), `M0` (shell).
