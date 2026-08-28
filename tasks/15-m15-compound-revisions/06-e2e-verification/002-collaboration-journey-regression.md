---
id: M15.6.2
status: done
depends: [M15.6.1, M15.5]
epic: m15-compound-revisions
feature: e2e-verification
area: qa
---

# M15.6.2 — Regression pass: M6 collaboration journeys against compound revisions

## Context

`m6-journeys.spec.ts` (journeys 5-8: revision spine + time travel, history + diff +
restore, the conflict drawer, usages + UID-rename warning) was written and last
verified against a backend where every revision touches exactly one asset, and against
a time-travel read-only mode that (per `M15.5`'s findings) only ever actually enforced
itself inside the page editor. This milestone changes the revision-creation behavior of
project setup, the UID-rename cascade, template-folder migration, and project restore
— journeys 6 (diff/restore) and 8 (usages/UID-rename) exercise exactly the call sites
`M15.2.2` changes — and now also enforces read-only mode across every editor surface
while time-travel is active (`M15.5`). This task is the explicit regression pass
confirming those journeys still pass under both changes, not an assumption that "the
unit/integration tests passing is enough."

## Goals

- Run (or, where execution isn't possible in this environment, carefully re-read
  against the `M15.2`/`M15.4`/`M15.5` changes) journeys 5-8 in `m6-journeys.spec.ts`,
  paying particular attention to any step that: counts revisions, asserts a specific
  revision id, triggers the UID-rename cascade and checks the resulting revision/
  warning, exercises project-wide restore, or enters/exits time-travel mode and
  interacts with an editor while it's active.
- Fix any journey step whose expectation was implicitly tied to the pre-`M15.2`
  revision-count/numbering behavior (same category of fix as `M15.2.1`/`M15.3.2`'s
  backend test audits, applied to the E2E layer), or to pre-`M15.5` behavior where an
  editor other than the page editor was silently writable during time travel.
- Record the outcome (pass / gated-and-collects-cleanly / specific failures fixed) in
  this task's result, mirroring how `M6`'s and `M7`'s own READMEs documented their
  E2E verification status honestly rather than claiming untested success.

## Acceptance criteria

- [x] `m6-journeys.spec.ts` (journeys 5-8) passes when run with `SF_RUN_E2E=1`, or, if
      still gated by the deferred demo seed, `npx playwright test m6-journeys.spec.ts --list`
      collects cleanly and a manual read-through confirms no step depends on
      pre-`M15.2` revision numbering or pre-`M15.5` partial read-only enforcement. —
      Still gated (same missing demo seed as `M15.6.1`); `--list` collects cleanly
      (`Total: 4 tests in 1 file`) and the manual read-through below found the suite is
      otherwise sound against both changes. Not executed against a live backend.
- [x] Any fix required is scoped to the E2E spec's own expectations, not to product
      behavior — if a real UX regression is found instead, it's filed back against the
      relevant `M15.2`/`M15.4`/`M15.5` task rather than papered over here. — One spec-only
      fix applied (see Result below); no product-level regression found.

## Result (read-through, `SF_RUN_E2E` not available in this environment)

Read all four journeys against the current `AssetServiceImpl`/`TemplateServiceImpl`/
`ProjectRestoreService` (post-`M15.2`), `revision-summary.util.ts`/`revisions-list`/
`revision-spine` (post-`M15.4`), and `readonly.interceptor.ts` + every editor surface's
`readOnly()` gate (post-`M15.5`):

- **Journey 5** (UID rename + affected-template warning): single-asset mutation
  (`AssetServiceImpl.changeUid` on a MEDIA asset), not time-travel. Unaffected by
  compound-revision numbering (still exactly 1 revision) and never enters time travel,
  so `sf-uid-rename`'s new `readOnly()` gate (`M15.5`) never engages here. No change
  needed.
- **Journey 6** (concurrent-edit conflict drawer): a page save, still a single-asset
  revision; unrelated to time travel. No change needed.
- **Journey 7** (time travel + restore): **found and fixed a pre-existing, `M15`-unrelated
  bug** — the spec navigated to `page.goto('/p/${PROJECT_KEY}/revisions')`, but
  `RevisionsListComponent` has only ever been mounted at
  `/p/:projectKey/settings/revisions` (`app.routes.ts`); the top-level path doesn't
  match any route and silently falls through to the `**` → `''` redirect, landing back
  on the dashboard instead of the revisions list — so `sf-revisions-list` would never
  become visible and the journey would time out regardless of this milestone's changes.
  Fixed the `goto` path. Everything downstream of that (spine tick click →
  `sf-project-shell .shell__timemachine` banner, diff view, conditional "Restore this
  asset") was re-checked against `project-shell.component.html`/`revision-diff.component.ts`
  and still matches: the restore endpoint is explicitly exempted from the read-only
  interceptor (`RESTORE_PATH = /\/restore$/` in `readonly.interceptor.ts`), so restoring
  while time-travelling still succeeds exactly as the journey expects.
- **Journey 8** (referenced-media delete confirmation): not time-travel, single-asset
  delete. `media-detail-drawer.component.ts`'s new `readOnly()` gate only disables the
  Delete button when `TimeTravelStore.isTimeTravel()` is true, which it isn't in this
  journey's fresh page/session — no change needed.

No step in any of the four journeys asserted a hardcoded revision id/count that the
project-creation-related numbering shift (`M15.2.1`'s "revision 1 not revision 9")
could invalidate — none of them create a *new* project (all reuse the seeded `demo`
project via `PROJECT_KEY = 'demo'`), so `M15.2`'s revision-count changes don't touch
these journeys' assumptions at all.

## Out of scope

- Writing new collaboration journeys — only regression-verifying the existing ones.

## Notes / hazards

- Be honest in the result write-up about what was actually executed vs. only read
  through, matching this repo's existing convention (`tasks/06-m6-revision-ux/README.md`'s
  "Implementation status" section, `tasks/07-m7-hardening/`'s "Honest gaps / follow-ups"
  section) of never claiming a gated E2E suite passed when it was only verified to
  collect cleanly.
