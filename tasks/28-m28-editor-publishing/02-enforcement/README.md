# Feature: Enforcement across release, schedules and generation

**Spec:** Extends §8.3/§8.4, §18.1 (triggers), §18.5 (run record), §26.3 (audit).

## Goal

Guard every publish-related endpoint with the policy instead of a fixed `DEVELOPER` minimum, apply the body-dependent
generation rules in one place shared with the scheduler, and close the generation attribution/audit gaps.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-release-and-schedule-authorization.md](001-release-and-schedule-authorization.md) | `M28.1.1` |
| 2 | [002-generation-authorization-and-attribution.md](002-generation-authorization-and-attribution.md) | `M28.1.1` |
| 3 | [003-permission-matrix-test.md](003-permission-matrix-test.md) | `M28.2.1`, `M28.2.2` |

## Feature exit criteria

- [x] Release/discard/unpublish, schedules and generation endpoints follow epic decisions 7–9 for every role × policy
      combination (matrix test).
- [x] The scheduler re-checks owners through `PublishPermissionEvaluator` and fails actions whose owner lost the
      permission.
- [x] Runs store `comment`, expose `startedBy`; start/cancel/promote are audited.

## Dependencies

`M28.1.1`; M27 release endpoints and scheduler engine.
