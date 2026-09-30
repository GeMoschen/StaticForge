---
id: M35.2
status: done
depends: [M35.1]
epic: m35-ui-ux-overhaul
feature: groundwork
area: frontend
---

# M35.2 — Decompose large components (behaviour-preserving)

## Context

User decision 22. The largest components (ts + html + scss, in lines):

| Component | Lines |
|---|---|
| `media/media-detail-drawer` | 1991 |
| `templates/templates` | ~1900 (+3 scss partials) |
| `pages/page-editor` | 1606 |
| `media/media-library` | 1523 |
| `settings/project-settings-export` | 1124 |
| `changes/changes` | 1075 |
| `settings/project-settings-import` | 1000 |
| `generation/generation` | 993 |
| `content/record-editor` | 934 |
| `content/dataset-schema-editor` | 920 |

## Goals

- Split each into cohesive sub-components and services along its visible regions and responsibilities. Examples:
  - Media drawer: preview, metadata form, focal point, versions, usages.
  - Templates: tree pane, metadata header, CDL panel, channel panel, save coordinator.
  - Page editor: header/meta, scope router, section palette, issues panel, preview split, conflict drawer.
- Move state that several parts share into a feature-scoped store service (signals), not into input/output chains
  that are several levels deep.
- Move the page editor's section palette and the templates' dirty/save coordination into their own units, so that
  M35.13 and M35.18/M35.21 can change them in isolation.
- Delete dead code found on the way: `features/design/design-demo.*`, the unused `.site-header*` rules in
  `app.component.scss`, and duplicate `.visually-hidden` classes (use the global `.sf-sr-only`).

## Acceptance criteria

- [x] No component (ts) above ~400 lines, and no template above ~200 lines, among the ten above. Document any
      justified exception.
- [x] No behaviour change: the existing vitest specs pass unchanged (spec files may be split and moved, but no
      assertion is weakened).
- [ ] Journeys m17, m19, m20 and m28 still pass their UI steps. Note known pre-existing failures as in M34.
- [x] `npx ng build` green.

## Out of scope

- Any visual change, new feature or new pattern.

## Notes / hazards

- Keep public selectors and `data-sf-*` hooks the journeys use (`data-sf-editor`, `data-sf-section`, …).
- Beware of changing effect order when moving signals across components. The UI is zoneless (see
  `tasks/lessons.md`).

## Review (2026-09-30)

- All ten components split into sub-components plus feature-scoped signal stores/services (media drawer and library,
  templates incl. `templates-save.coordinator` and `TemplatesStore`, page editor incl. `section-palette.*`, export and
  import, changes, generation, record editor, dataset schema editor). Every ts <= ~400 lines (one at 403:
  `record-editor.component.ts`) and every html < 200 among the ten. Effects stay in the shell constructors, same order.
- Dead code removed: `features/design/design-demo.*`, `.site-header*` in `app.component.scss`, all `.visually-hidden`
  duplicates (now `.sf-sr-only`).
- Specs: 144 files / 946 tests green. Spec edits: `templates.component.spec.ts` reaches members via the new services
  (22 expects before and after), `page-editor-meta.spec.ts` and `page-nav-settings.component.spec.ts` import the real
  header component. `npx ng build` green (only pre-existing NG8102 warnings).
- Not done: journeys m17/m19/m20/m28 (need a dev backend). The page-editor scope/issues/preview/palette templates are
  not rendered by any unit spec, so the journeys are their real check.
- Noticed, pre-existing, not fixed: the media library grid's infinite-scroll observer attaches at `ngAfterViewInit`
  but the sentinel sits in an `@else` branch, so later pages may never auto-load.
