---
id: M9.3.2
status: todo
depends: [M9.3.1]
epic: m9-project-scoped-uuids
feature: cross-project-import-identity
area: qa
---

# M9.3.2 — Update existing export/import tests for the new UUID default

## Context

Any existing test asserting "an imported asset's UUID differs from the exported
asset's UUID" (a reasonable assertion under the pre-`M9.3.1` unconditional-remap
behavior) is now only correct for the collision case — the common case
(importing into a project that's never seen these UUIDs) should assert the opposite.

## Goals

- Find and update every existing test around `ProjectExportImportServiceImpl` /
  `ProjectExportController` / `ProjectImportController` that asserts on UUID identity
  before vs. after import.
- Add explicit coverage for both branches of `M9.3.1`'s behavior in one place if it
  doesn't already exist as part of that task's own tests: same-project re-import
  (collision → remap) and cross-project import (no collision → preserve).
- Confirm `ImportResult`'s counts (`importedAssetCount`, `importedBlobCount`) are
  unaffected by which branch a given asset took — the count is "how many assets/blobs
  were created," independent of whether their UUID was preserved or remapped.

## Acceptance criteria

- [ ] No test in the suite asserts "imported UUID != source UUID" as a universal
      truth — any such assertion is scoped to the specific collision scenario it's
      actually testing.
- [ ] Full backend test suite is green.

## Out of scope

- New tests for `M10`'s conflict-detection UI-facing behavior — this task is strictly
  about keeping `M9`'s own existing test coverage honest.

## Notes / hazards

- This task exists because `M9.3.1` is a genuine behavior change to already-tested
  code, not because new functionality needs new tests from scratch — treat it as a
  test-audit pass, not a rewrite of the whole suite.
