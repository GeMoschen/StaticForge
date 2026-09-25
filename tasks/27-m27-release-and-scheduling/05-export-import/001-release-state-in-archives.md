---
id: M27.5.1
status: done
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

- [x] Round trip (`KEEP`): a project with published, changed (per locale), unpublished, deletion-pending and new assets,
      and a localized media with two files, imports into an empty project with identical statuses per locale and an
      identical full build.
- [x] `DRAFT`: every imported asset `NEW`; a build of the imported project produces no pages.
- [x] Protocol 7 fixture imports as drafts with the info entry; protocol 6 behaviour (M25 conflicts) unchanged.
- [x] Missing locale → `RELEASE_LOCALE_MISSING` warning, pointer dropped, import succeeds.
- [x] `./gradlew build` green.

## Out of scope

- Exporting schedules (not exported — decision 28); UI (`M27.5.2`).

## Notes / hazards

- Import writes happen inside one import revision today; opening pointers must reference version ids created in that
  same revision — make the release write part of the import batch, not a second revision.

## Implementation notes

- **Archive.** `ExportedAsset` gains `release: [ExportedRelease]` (`null` for types that aren't releasable and in
  protocol ≤ 7 archives) and `draftDeleted`. `ExportedRelease` = `{locale, state, uid?}`, plus for `PAYLOAD` the
  released version's payload, display name, parent folder uuid, folder path, template uuid and (media) MIME type and
  size. `uid` only when the released uid differs from the asset's (a uid change writes no version). Entries are sorted
  by locale; `@JsonInclude(NON_NULL)` keeps `DRAFT_EQUALS` entries to one line.
- **Beyond the task text: `UNPUBLISHED` entries.** Open pointers alone can't tell `UNPUBLISHED` from `NEW` (the status
  reads the pointer *history*), so the round trip acceptance needs a third state: a locale key released once without
  an open pointer now. It is imported as a pointer opened and closed in the import revision — valid at no revision,
  it only feeds `findEverReleasedKeys`. Not written for a tombstone (a deleted draft without pointer has no status).
- **Deletion pending.** The export adds every open tombstone that still has an open pointer, plus the deleted folders
  above it (so the archive parent chain stays intact). Its draft is imported as a tombstone (`deleted = true`), its
  released versions as below. A `DRAFT` import leaves these assets out entirely (`ArchiveContent.forReleaseMode`):
  without their released versions they would only delete.
- **Released versions (the approach the task asked to pick).** Each distinct released `PAYLOAD` becomes one extra
  version of the asset, *opened and closed in the import revision* (`validFrom = validTo = R`). It is never the
  version valid at any revision, so the "at most one valid version per revision" invariant holds and every reader
  that looks up versions by revision is unaffected; only the pointer (by version id) reads it. Draft, released
  versions, pointers and summary entries (`RELEASE` per asset and locale) all belong to the one `IMPORT` revision.
  Entries of several locales with the same content share one version. The released payload gets the same UUID remap
  and the same `origin` block as the draft, so the per-locale projections compare exactly as in the source (a locale
  that was `PUBLISHED` against an older version stays `PUBLISHED`). Its parent resolves through the import's id map
  (fallback: the draft's placement); its folder path is the archive's, rebased onto the target's folder paths
  (`PathRebase`, longest imported-folder prefix) — needed when uids were re-derived in the target.
- **Locales.** An entry is kept when the asset has that key in the target — computed with the languages the target
  will have after the import (its own, or the archive's when it has none and the archive brings them). `""` stands for
  every language *of the archive*: into a localized target it releases only the target languages the archive also
  has (decided with the user, 2026-09-25); a target language the archive lacks stays `NEW`. The archive's languages
  come from `ExportManifest.locales` (new in protocol 8, written even when settings aren't exported). An archive
  without languages counts as the target's default language (decided with the user): its `""` pointers release that
  language only. Any other key, and a `""` entry that matches no
  target language, is dropped with one `RELEASE_LOCALE_MISSING` warning per asset (unpublished keys are dropped
  silently — nothing rendered there).
- **Overwritten assets.** `KEEP` replaces the target's open pointers with the archive's (the import always wins, and
  that is what makes the round trip exact); `DRAFT` leaves the target's release state alone, so a draft import never
  changes the live site. Skipped implicit assets are untouched either way. An import restores state; it is not a
  release, so there is no completeness gate.
- **Blobs.** Export and import now walk a media payload's `localeFiles` (and their variants) and the payloads of
  released versions (`blobShas`); a blob is counted once per asset whether the draft, a released version or both hold
  it.
- **Analysis/API.** `ConflictReport` gains `releaseState` (protocol ≥ 8) and `releaseMode` (the mode that applies:
  `DRAFT` for an archive without release state); a protocol ≤ 7 archive lists an `INFO` entry
  `ARCHIVE_WITHOUT_RELEASE_STATE` (new severity `INFO`: neither blocks nor warns). `releaseMode` (`KEEP` default |
  `DRAFT`) is a request parameter of `POST …/import` and `…/import/analyze`; `ImportResultView.releasedCount` counts
  the pointers opened. `ImportOptions(boolean)` keeps its old meaning (`KEEP`), so existing callers are unchanged.
- **Reference edges of imported released versions** (found while writing the notes, fixed). `asset_reference` holds
  one edge set per asset and revision; in the import revision that is the draft's, so `findReleasedEdgeRowsValidAt`
  gave an imported released version its draft's edges, and a page whose *released* version alone referenced X was not
  re-planned when X was released later. `RebuildExpansion.rows` now also extracts the edges of released versions that
  are valid at no revision (`AssetReleaseRepository.findUnmaterializedReleasedVersionsValidAt`, only an import writes
  them) from their payloads (`ReferenceMaterializer.extract`). Test first failed with an empty plan.
- **Tests:** `ReleaseStateExportImportIntegrationTest` (8: `KEEP` round trip with statuses and byte-identical full
  build incl. a moved page, a deletion-pending page and a localized media whose English file changed after release;
  `KEEP` over existing assets; an imported released version's own references seed an incremental plan; `DRAFT`;
  missing locale; an all-languages pointer releases only the archive's languages; an archive without languages
  is released in the target's default language only; protocol 7 fixture `exportimport/protocol-7-no-release-state`),
  `ProjectImportAnalyzeApiTest` (+1: `releaseState`/`releaseMode`/`INFO` over HTTP, `releasedCount`),
  `ProjectExportImportIntegrationTest` (protocol version 8).
