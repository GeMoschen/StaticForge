---
id: M15.6.2
status: todo
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

- [ ] `m6-journeys.spec.ts` (journeys 5-8) passes when run with `SF_RUN_E2E=1`, or, if
      still gated by the deferred demo seed, `npx playwright test m6-journeys.spec.ts --list`
      collects cleanly and a manual read-through confirms no step depends on
      pre-`M15.2` revision numbering or pre-`M15.5` partial read-only enforcement.
- [ ] Any fix required is scoped to the E2E spec's own expectations, not to product
      behavior — if a real UX regression is found instead, it's filed back against the
      relevant `M15.2`/`M15.4`/`M15.5` task rather than papered over here.

## Out of scope

- Writing new collaboration journeys — only regression-verifying the existing ones.

## Notes / hazards

- Be honest in the result write-up about what was actually executed vs. only read
  through, matching this repo's existing convention (`tasks/06-m6-revision-ux/README.md`'s
  "Implementation status" section, `tasks/07-m7-hardening/`'s "Honest gaps / follow-ups"
  section) of never claiming a gated E2E suite passed when it was only verified to
  collect cleanly.
