# M6 — Revision UX & collaboration

**Spec:** §24 (UI/UX: revision spine, time travel), §7.5/7.6, §5.4 (usages).
Roadmap M6 (§27): 3 weeks.

## Goal

Surface the product's differentiator — the revision spine — and complete the
collaboration story: time travel, diff/restore, the conflict drawer, usages panel, and
UID-rename warnings.

## Exit criteria (epic is done when)

- [ ] Journeys 5–8 (§25.6) pass. _(spec written in `ui/e2e/m6-journeys.spec.ts`, gated behind `SF_RUN_E2E=1` — blocked on the still-deferred demo seed; the underlying capabilities are proven by the backend integration tests + `ng build` + vitest.)_

## Implementation status

All 8 tasks implemented across 5 agents (1 backend + 3 frontend + 1 QA):

| Feature | Deliverables |
|---|---|
| revision-spine | `revision-spine.component.ts` (44px rail, filled/hollow ticks, hover label, incoming pulse), `time-travel.store.ts`, amber time-travel bar in `project-shell`, read-only `page-editor`/`section-editor` via `assetVersion` |
| history | `revisions.service.ts`, `revisions-list.component.ts` (filters + windowed virtual scroll), `revision-diff.component.ts` (side-by-side diff + asset restore + project rollback), real `sf-diff.component.ts` |
| conflict | per-field merge drawer (`conflict-util.ts`, `ConflictInfo.base/theirs`, `resolveFields`, `If-Match` resubmit) |
| usages | `sf-uid-rename.component.ts` + affected-templates amber warning; media delete `DialogService` proportional confirmation |
| collaboration-e2e | `m6-journeys.spec.ts` (journeys 5–8, gated) |

Verified: `./gradlew build` green (incl. block-diff + revision-filter + UID-warning +
dual-payload tests); `ui` `npm run build` green; vitest green (70 tests).

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [revision-spine](01-revision-spine/README.md) | frontend | — |
| 2 | [history](02-history/README.md) | frontend | 1 |
| 3 | [conflict](03-conflict/README.md) | frontend | — |
| 4 | [usages](04-usages/README.md) | frontend+backend | — |
| 5 | [collaboration-e2e](05-collaboration-e2e/README.md) | qa | 1–4 |

## Dependencies

`M1` (revisions API, diff/restore), `M2` (asset_reference), `M3` (editors/editor UI).
