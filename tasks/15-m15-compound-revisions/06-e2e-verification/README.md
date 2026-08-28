# Feature: End-to-end verification

**Spec:** §25.6 (critical E2E journeys — journeys 1, 6, 7 touch project creation and
the revision spine/diff/restore UX this milestone changes).

## Goal

Close the loop with real end-to-end proof, at both the API and browser level, that
compound revisions work as designed and that the milestone's two explicit product
promises — "setting up a project is one revision" and "viewing a revision is read-only
everywhere" — hold, plus a full regression pass over the collaboration journeys (`M6`'s
journeys 5-8) this milestone's UI changes sit on top of.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-project-setup-one-revision-journey.md](001-project-setup-one-revision-journey.md) | `M15.2`, `M15.4` |
| 2 | [002-collaboration-journey-regression.md](002-collaboration-journey-regression.md) | 1, `M15.5` |

## Feature exit criteria

- [ ] A new Playwright journey creates a project through the real UI/API and asserts,
      via the revision spine and history list, that exactly one revision exists
      afterward, showing the correct asset count.
- [ ] `m6-journeys.spec.ts` (journeys 5-8: revision spine/time-travel, history/diff/
      restore, conflict drawer, usages/UID-rename) passes unmodified in intent against
      the compound-revision backend and updated UI.
- [ ] Both suites are gated the same way the existing E2E suite already is
      (`SF_RUN_E2E=1`), consistent with `M6`/`M7`'s precedent — this milestone doesn't
      change the demo-seed/gating situation.

## Dependencies

`M15.2` (orchestrated writes — the behavior being proven end-to-end), `M15.4`
(revision UX — the surfaces the journey drives through), `M15.5` (time-travel
read-only everywhere — the behavior journey 5/8's regression pass also verifies),
`M6:collaboration-e2e` (`m6-journeys.spec.ts`, the existing suite being
regression-tested).
