---
id: M15.6.1
status: done
depends: [M15.2, M15.4]
epic: m15-compound-revisions
feature: e2e-verification
area: qa
---

# M15.6.1 — E2E journey: project setup is one revision

## Context

The epic's headline exit criterion — "creating a project produces exactly one
revision" — is proved at the integration-test level by `M15.2.1`'s own task, but has
no browser-level proof that a real user creating a project through the actual UI sees
exactly one tick on the revision spine and one row in the history list, with the
correct asset-count affordance from `M15.4.1`. This task adds that journey, following
the existing `ui/e2e/m6-journeys.spec.ts` / `ui/e2e/m7-journeys.spec.ts` pattern and
gating convention (`SF_RUN_E2E=1`, per `ui/e2e/README.md`'s 12-journey map).

## Goals

- Add a new Playwright spec (`ui/e2e/m15-journeys.spec.ts`, or append to the existing
  journey map if a natural slot exists) that: logs in, creates a new project through
  the real project-creation UI flow, navigates to the project's revision history/spine,
  and asserts exactly one revision is present with an asset-count affordance matching
  the number of bootstrap folders (+ project entry, per `M15.2.1`'s decision on
  whether the default channel is included).
- Open that single revision's diff view and assert all bootstrap assets (the fixed
  folders, per the epic README's list) appear as `CREATE` entries.
- Update `ui/e2e/README.md`'s journey map with the new journey's number/description,
  consistent with how `M6`/`M7` each registered their own journeys there.

## Acceptance criteria

- [ ] The new journey passes when run with `SF_RUN_E2E=1` against a real backend. —
      **Not executed.** `db/changelog/data/demo-project.xml` is still the M1 placeholder
      changeset (a single no-op `demo-project-placeholder` changeSet), so there is no
      seeded demo user/project to log in as in this environment — the identical blocker
      `m6-journeys.spec.ts` and every journey spec since M5 document. Confirmed by
      reading the changelog directly rather than assuming.
- [x] `npx playwright test m15-journeys.spec.ts --list` collects cleanly (proves the
      spec is syntactically valid and discoverable, matching `M7`'s own verification
      precedent for a gated suite that can't be executed in every environment). Verified:
      `Total: 1 test in 1 file`.
- [x] `ui/e2e/README.md` lists the new journey.

## Out of scope

- Un-gating E2E execution generally — this journey follows the existing gated
  convention, doesn't change it.
- The collaboration-journey regression pass — `M15.6.2`.

## Notes / hazards

- If a demo-seed/fixture project is required for login/setup preconditions and is
  still deferred (per `M6`/`M7`'s own "blocked on the still-deferred demo seed" notes),
  this journey may be gated the same way and its "collects cleanly" acceptance
  criterion is the practical bar to clear in this environment, exactly as `M7` treated
  its own gated journeys.
