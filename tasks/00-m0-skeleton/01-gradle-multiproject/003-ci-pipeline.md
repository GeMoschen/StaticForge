---
id: M0.1.3
status: done
depends: [M0.1.1, M0.1.2]
epic: m0-skeleton
feature: gradle-multiproject
area: infra
---

# M0.1.3 — CI pipeline

## Context

Provide a continuous-integration pipeline so every task in later epics is validated on
push (§25.7 quality gates reference CI).

## Goals

- Add CI workflows (GitHub Actions or equivalent) that, on every push/PR:
  - Bootstrap Gradle and run `./gradlew build` (compiles all `server` modules).
  - Run `spotlessCheck`, `check`, unit + slice tests.
  - Build the Angular workspace and run its unit tests (initially a trivial suite).
- Cache Gradle and Angular dependencies for fast feedback.
- Fail on test failures, lint violations, or bundle-budget regressions once defined.

## Acceptance criteria

- [ ] A push runs the full pipeline and it is green on the skeleton.
- [ ] Unauthorized merge is blocked (branch protection / required checks) where the
      repo host allows configuration-as-code.
- [ ] CI logs are locatable per run; a failing test is attributable to a task.

## Out of scope

- Nightly Postgres/Testcontainers dialect job (added later, §22.3) and performance jobs
  (M7). Leave hooks/placeholders only.

## Notes / hazards

- Keep the workflow file simple and parameterised so M7 can extend it without a rewrite.
