---
id: M27.5.1
status: todo
depends: [M27.1.1, M27.3.1]
epic: m27-release-and-scheduling
feature: export-import
area: backend
---

# M27.5.1 — Protocol 8: release state and localized media files in archives

## Context

`sf-domain/.../exportimport/ProjectExportImportService.java` (`PROTOCOL_VERSION = 7`, `:31`),
`ProjectExportImportServiceImpl` (export `:290` builds the ZIP in memory; `importBlob` `:1173`), per-asset export files
(M14), import analysis (`ImportConflictView`, `import/analyze`), `ProjectExportImportIntegrationTest`,
`ProjectImportAnalyzeApiTest`, protocol fixtures under `server/sf-app/src/test/resources/exportimport/`. Epic
decisions 12, 18, 28.

## Goals

- **Export (protocol 8).** Each releasable asset's export file gains `release: [{locale, state: "DRAFT_EQUALS" |
  "PAYLOAD", payload?, displayName?, folderPath?, uid?}]` for every open pointer: `DRAFT_EQUALS` when the pointer is at
  the exported (current) version, otherwise the released version's payload and structural fields (so an archive can
  reproduce "published v1, draft v2"). Localized media export every locale file's blob. Deleted-but-still-released
  assets (`DELETION_PENDING`) are exported with their released version and a `draftDeleted: true` marker.
- **Import.** New request option `releaseMode: KEEP | DRAFT` (default `KEEP`) on import (and shown in `import/analyze`
  results as the default):
  - `KEEP`: for each exported pointer, create the released version (an extra version before the draft when the
    released payload differs — two versions of the asset in the import revision is fine; or a closed historical
    version: pick the approach that keeps revision invariants, note it) and open the pointer; locales not configured in
    the target project are reported as a conflict `RELEASE_LOCALE_MISSING` (warning; pointer dropped).
  - `DRAFT`: no pointers; every imported asset is `NEW`.
  - Protocol ≤ 7 archives: always `DRAFT`, with an info entry in the analysis ("archive has no release state").
- **Selective export** of assets keeps their release data; a dependency pulled in implicitly carries its own.
- Bump `PROTOCOL_VERSION` to 8; add a protocol-7 fixture test (imports as drafts, everything else unchanged).
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] Round trip (`KEEP`): a project with published, changed (per locale), unpublished, deletion-pending and new assets,
      and a localized media with two files, imports into an empty project with identical statuses per locale and an
      identical full build.
- [ ] `DRAFT`: every imported asset `NEW`; a build of the imported project produces no pages.
- [ ] Protocol 7 fixture imports as drafts with the info entry; protocol 6 behaviour (M25 conflicts) unchanged.
- [ ] Missing locale → `RELEASE_LOCALE_MISSING` warning, pointer dropped, import succeeds.
- [ ] `./gradlew build` green.

## Out of scope

- Exporting schedules (not exported — decision 28); UI (`M27.5.2`).

## Notes / hazards

- Import writes happen inside one import revision today; opening pointers must reference version ids created in that
  same revision — make the release write part of the import batch, not a second revision.
