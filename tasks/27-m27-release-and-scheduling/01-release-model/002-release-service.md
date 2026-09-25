---
id: M27.1.2
status: todo
depends: [M27.1.1]
epic: m27-release-and-scheduling
feature: release-model
area: backend
---

# M27.1.2 — `ReleaseService`: release, unpublish, discard, dependency closure, structural drafts

## Context

`M27.1.1` (`asset_release`, `ReleaseState`, `ReleaseStatusService`, `LocaleProjection`), `revision/RevisionService`
(`allocate`, `beginBatch`/`allocateOrJoin`, `allocateEvenIfArchived`), `asset/AssetServiceImpl` (`softDelete` `:353`,
`restore`, `move`, `changeUid`, `insertVersion` `:710`), `asset/AssetReferenceRepository` (edges valid at head),
`asset/content/ContentValidator`, `asset/content/PageContentValidator`, `asset/page/PageContentValidation`
(completeness findings), `asset/folder/FolderServiceImpl` (`delete`), `asset/localization/LocalizationMigrationService`
(system migration, decision 13). Epic decisions 7–15.

## Goals

- **`ReleaseService`** (domain, `@Transactional`, one revision per call via `beginBatch`):
  - `release(projectId, List<ReleaseItem(assetUuid, locale, pinnedVersionId?)>, comment, actor)` → opens a pointer
    per item at the pinned version (default: the open version). `ChangeType.RELEASE`.
  - `unpublish(projectId, items, comment, actor)` → closes the pointers. `ChangeType.UNPUBLISH`.
  - `discard(projectId, items, actor)` → writes the released version's locale projection back as a new version
    (decision 11, incl. `sharedFieldsKept`). `ChangeType.DISCARD`. Refused for `NEW` (`422 SF-DOM-0152`).
  - `plan(projectId, items)` → dry run: the resolved items, the proposed **dependency closure** (decision 9: reverse of
    "what the selection references" — `asset_reference` edges valid at head to releasable assets not `PUBLISHED` in the
    same locale, transitively; plus unreleased ancestor editorial folders; for a folder rename, its `CHANGED`
    descendants as an optional group), completeness findings, and warnings (e.g. `sharedFieldsKept`).
  - Each operation takes an explicit `ReleasePermissionCheck` hook (single method per operation, decision 15), so M28
    can swap the rule without touching the service.
- **Completeness gate.** Releasing an item whose version has `ERROR` completeness findings in that locale fails the whole
  call: `422 SF-DOM-0150` "Content incomplete" with `assets[{uuid, locale, issues[]}]`. A pinned version is validated
  with the **current** compiled CDL of its template.
- **Deletion semantics.** Releasing a `DELETION_PENDING` item = closing its pointer (unpublish). `AssetService.softDelete`
  of an asset that is `NEW` in every locale keeps today's behaviour; of anything else it writes the tombstone draft only.
  `FolderService.delete(cascade)` follows the same rule per descendant.
- **Structural moves/renames** need no special code (they are versions) — prove it with tests: the released version keeps
  its old folder path and uid.
- **System migrations carry releases forward** (decision 13): `LocalizationMigrationService` and the CDL content
  migration move the pointer of every `PUBLISHED` locale to the migrated version in the migration revision. Put the
  helper on `ReleaseService` (`carryForward(assetIds, revision)`), not in each migration.
- **Project restore** (`ProjectRestoreService.restoreTo`) leaves pointers untouched (decision 14) — test it.
- **Validation errors:** unknown asset/locale or a non-releasable type → `422 SF-DOM-0151`; releasing an item already
  `PUBLISHED` is a no-op per item (reported, not an error); an empty effective selection → `422 SF-DOM-0153`; a pinned
  version that doesn't belong to the asset → `422 SF-DOM-0154`.
- **Revision summary**: `summary.assets[]` gains `locale` and `releasedVersion` per released/unpublished/discarded item,
  so the revision spine and diff (§7.6) can show them.

## Acceptance criteria

- [ ] Release/unpublish/discard each produce exactly one revision with the right `ChangeType` and summary; the revision
      counter is unchanged on any refusal (lessons: assert the rollback).
- [ ] Dependency closure: page → new media → proposed; page → record set → new record → proposed transitively; ancestor
      folder not released → proposed; a dependency `PUBLISHED` in that locale → not proposed; cycles terminate.
- [ ] `422 SF-DOM-0150` lists every incomplete item; nothing is released.
- [ ] Discard of EN only restores the EN values; with DE `CHANGED` on a shared field the shared fields stay and
      `sharedFieldsKept` is reported.
- [ ] Deleting a `NEW` page is immediate (no pointer, gone from the tree); deleting a `PUBLISHED` page leaves the
      pointer and yields `DELETION_PENDING`; releasing it closes the pointer.
- [ ] The M24 localizable toggle on a template with published pages leaves those pages `PUBLISHED`.
- [ ] Archived project: every mutation `409 SF-DOM-0141`; `plan` allowed.
- [ ] `./gradlew build` green.

## Out of scope

- REST (`M27.1.3`), rendering (`M27.2.x`), scheduling (`M27.4.x`), editor permissions (`M28`).

## Notes / hazards

- Lessons: service overloads both abstract, never `default` methods delegating to `@Transactional` ones.
- A release of 500 assets × 3 locales must stay one revision and fast: batch inserts, one status evaluation per
  (asset, locale).
- The closure uses edges **valid at head** (the draft's references); the released version may reference other
  things — that's intended (the draft is what is being released).
- Record sets: releasing a record set releases its query, not its records (records are separate assets); the closure
  proposes `NEW` records only when the draft query selects them — document the rule, keep it simple: propose records
  that are members of the set and not `PUBLISHED`.
