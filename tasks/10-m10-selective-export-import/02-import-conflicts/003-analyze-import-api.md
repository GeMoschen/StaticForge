---
id: M10.2.3
status: todo
depends: [M10.2.2]
epic: m10-selective-export-import
feature: import-conflicts
area: backend
---

# M10.2.3 — Analyze-import REST endpoint + commit-path guard

## Context

The UI needs a call that takes the uploaded ZIP and returns a `ConflictReport` before
the user commits to anything, and the existing commit endpoint
(`ProjectImportController.importArchive`) needs to refuse blocking conflicts itself —
not just trust that the UI called analyze first.

## Goals

- New `POST /api/v1/projects/{projectKey}/import/analyze` (multipart, same `file`
  param as the existing `POST /import`), same `ProjectRoleExpr.ADMIN` guard, returning
  a `ConflictReportView` (flat DTO mirror of `ConflictReport`/`ImportConflict`).
- `ProjectImportController.importArchive` calls
  `assertNoBlockingConflicts` (from `M10.2.2`) before delegating to `importProject`,
  and returns **409 Conflict** with a problem-detail body listing the blocking
  conflicts if any are present — reuse `ProblemFactory`'s existing conflict/4xx
  helpers, add one if none fits.
- Existing whole-project import behavior (no selection, no settings) must still
  succeed exactly as today when there are no blocking conflicts — this is a guard
  added in front of the existing path, not a rewrite of it.

## Acceptance criteria

- [ ] `POST .../import/analyze` on an archive with a missing template reference
      returns a 200 with a `ConflictReportView` containing that `BLOCKING` conflict —
      no data written (verify via a follow-up read of the target project's asset
      count, unchanged).
- [ ] `POST .../import` (commit) on the same archive returns 409 with the conflicts in
      the body, and confirms via the same asset-count check that nothing was written.
- [ ] `POST .../import` on an archive with only `WARNING`-level conflicts (e.g.
      `SETTINGS_KEY_COLLISION`) succeeds exactly as before, warnings are informational
      only.
- [ ] Existing `POST /import` tests for the current whole-project, no-conflicts case
      still pass unmodified.

## Out of scope

- Frontend calls to this endpoint (`M10.3`).

## Notes / hazards

- Keep `/import/analyze` idempotent and side-effect-free at the HTTP layer too — no
  temp state stored server-side between analyze and commit; the client re-uploads the
  same bytes for commit (matches how `/export` + `/import` already work as two
  independent calls, no session state).
