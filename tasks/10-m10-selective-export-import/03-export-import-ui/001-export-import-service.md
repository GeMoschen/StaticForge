---
id: M10.3.1
status: todo
depends: [M10.1.3, M10.2.3]
epic: m10-selective-export-import
feature: export-import-ui
area: frontend
---

# M10.3.1 — Import/export Angular service

## Context

Every settings tab has a thin service wrapping its API calls (see
`ui/src/app/features/settings/url-registry.service.ts` for the pattern to follow —
`HttpClient`, typed request/response interfaces, no component logic).

## Goals

- New `import-export.service.ts` with:
  - `exportSelection(projectKey, selection): Observable<Blob>` — `POST
    .../export/selection`, `responseType: 'blob'`, mirroring how the existing
    whole-project export download (if any client code already does this — check
    for a raw download link/button before assuming none exists) triggers a
    browser save.
  - `analyzeImport(projectKey, file): Observable<ConflictReportView>` — `POST
    .../import/analyze`, multipart.
  - `commitImport(projectKey, file): Observable<ImportResultView>` — `POST
    .../import`, multipart; must surface a 409 response body (conflicts) distinctly
    from other errors so the panel can render "conflicts changed since you analyzed"
    rather than a generic failure toast.
  - A project asset tree fetch to populate the export picker — check whether an
    existing endpoint/service already returns a folder/asset tree (the Page/Media
    store browser almost certainly has one) and reuse it rather than adding a new
    backend endpoint just for this picker.
- TypeScript interfaces matching the backend DTOs (`ExportSelectionRequest`,
  `ConflictReportView`, `ImportConflictView`, `ImportResultView`) — check
  `ImportResultView`'s existing Java shape (`sourceProjectKey`,
  `importedAssetCount`, `importedBlobCount`) before redeclaring it.

## Acceptance criteria

- [ ] Service methods have unit tests using `HttpTestingController` (matching how
      `url-registry.service.ts`'s tests, if any, or another settings service's tests
      are structured) verifying request URL, method, and body/response mapping.
- [ ] `commitImport`'s 409 handling is covered by a test asserting the conflict list is
      extracted from the error response body, not swallowed as a generic error.

## Out of scope

- Any component/template code (`M10.3.2`, `M10.3.3`).

## Notes / hazards

- Check whether a project-wide asset-tree-fetching service already exists before
  building a new one — duplicating "list this project's folder tree" would be exactly
  the kind of premature parallel implementation the codebase's working principles warn
  against.
