---
id: M10.1.3
status: todo
depends: [M10.1.1, M10.1.2]
epic: m10-selective-export-import
feature: selective-export
area: backend
---

# M10.1.3 — Export selection REST endpoint

## Context

`ProjectExportController` only exposes `GET /export` (whole project, no body). A
selection needs a request payload, so it needs its own route rather than overloading
the `GET`.

## Goals

- New `POST /api/v1/projects/{projectKey}/export/selection` accepting an
  `ExportSelectionRequest` JSON body (`assetUuids: string[]`, `includeChannels: boolean`,
  `includeGenerationTargets: boolean`) and returning the same
  `application/zip` attachment response shape as the existing `GET /export`
  (`ContentDisposition.attachment().filename(projectKey + ".zip")`).
- Same `@PreAuthorize("@projectAuth.has(#projectKey, " + ProjectRoleExpr.ADMIN + ")")`
  guard as the existing export/import endpoints — exporting is a data-extraction
  operation, no lower bar than the whole-project path.
- Keep `GET /export` exactly as-is (delegates to `exportSelection` with
  `ExportSelection.everything()` internally per `M10.1.1`) — no behavior change for
  existing callers.

## Acceptance criteria

- [ ] `POST .../export/selection` with a folder UUID returns a ZIP containing exactly
      that folder's subtree (integration test against a fixture project).
- [ ] `POST .../export/selection` with `includeChannels=true` and no asset UUIDs
      returns a ZIP with only `manifest.json` + `settings.json` (channels), no
      `assets.json` entries.
- [ ] `GET /export` output is unchanged (existing tests for it still pass unmodified).
- [ ] A malformed/empty selection returns 4xx with the project's standard problem-detail
      body, not a 500 or an empty-but-200 ZIP.

## Out of scope

- Conflict analysis endpoint (`M10.2.3`).
- Frontend wiring (`M10.3`).

## Notes / hazards

- Keep this controller thin (mirrors the existing `ProjectExportController` style) —
  all selection-expansion and redaction logic belongs in `ProjectExportImportService`,
  not the controller.
