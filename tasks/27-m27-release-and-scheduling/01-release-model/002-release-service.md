---
id: M27.1.2
status: done
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

- [x] Release/unpublish/discard each produce exactly one revision with the right `ChangeType` and summary; the revision
      counter is unchanged on any refusal (lessons: assert the rollback).
- [x] Dependency closure: page → new media → proposed; page → record set → new record → proposed transitively; ancestor
      folder not released → proposed; a dependency `PUBLISHED` in that locale → not proposed; cycles terminate.
- [x] `422 SF-DOM-0150` lists every incomplete item; nothing is released.
- [x] Discard of EN only restores the EN values; with DE `CHANGED` on a shared field the shared fields stay and
      `sharedFieldsKept` is reported.
- [x] Deleting a `NEW` page is immediate (no pointer, gone from the tree); deleting a `PUBLISHED` page leaves the
      pointer and yields `DELETION_PENDING`; releasing it closes the pointer.
- [x] The M24 localizable toggle on a template with published pages leaves those pages `PUBLISHED`.
- [x] Archived project: every mutation `409 SF-DOM-0141`; `plan` allowed.
- [x] `./gradlew build` green.

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

## Implementation notes

- **Service shape.** `ReleaseService.release/unpublish/discard(items, RevisionContext)` and `plan(projectId, items)`;
  `ReleaseItem(assetUuid, locale?, pinnedVersionId?)`. Items are resolved and checked first, then one batch revision
  is opened, so every refusal leaves the counter untouched (asserted). A call where every item is a no-op returns
  `revision = null` and writes nothing (`SF-DOM-0153` is only for an empty selection).
- **Permission hook.** `ReleasePermissionCheck` (`requireRelease/Unpublish/Discard(ctx)`), default
  `RoleReleasePermissionCheck`: `DEVELOPER+` member or active instance admin, read from the database because a
  scheduled action (M27.4) runs without a token; a context without a user is the system. M28 replaces this bean.
- **Deletion needs no new code:** `softDelete` already writes a tombstone; with a pointer that is `DELETION_PENDING`,
  without one the asset is simply gone. Releasing a `DELETION_PENDING` item closes its pointer (summary action
  `UNPUBLISH` inside the `RELEASE` revision).
- **Discard.** Whole discard (one key, a deleted draft, or every other locale published against the same released
  version) writes the released version back through the asset services joined into the batch: `changeUid` back to
  `released_uid`, then `restore(uuid, released.validFrom)` (folder, name, payload, containment checks, record-set
  rebasing), or for a folder `FolderService.move` (rewrites descendant paths) plus `AssetService.update`. To keep one
  revision, `AssetServiceImpl.restore/changeUid/move` and `FolderServiceImpl.move` now `allocateOrJoin` — every existing
  caller passes a standalone context, so their behaviour is unchanged. Per-locale discard merges the locale's
  translations back (`LocaleDiscard`, sections matched by `instanceId`) and reports `sharedFieldsKept` when the locale
  still differs from its release afterwards.
- **Carry-forward** lives in its own component `ReleaseCarryForward` (not on `ReleaseService`): the migrations it
  serves are low-level writers `ReleaseService` depends on through the asset services, so a method on the service
  would make a bean cycle. Wired into `LocalizationMigrationService.run` (M24 toggle, locale changes),
  `RecordRenameMigration` and `RecordSetQueryMigration` (dataset `renamedFrom`). A pointer moves when it pointed at the
  rewritten version or projected equal to it (was `PUBLISHED`).
- **Completeness gate** (`ReleaseCompleteness`): pages against their template (`PageContentValidation.issues`),
  records against their dataset schema, global sets against their own CDL; `COMPLETENESS` findings with `ERROR`
  severity. The validators aren't locale-aware (they check the payload as stored), which matches generation's hold-back.
- **Dependency closure** (`plan`): breadth-first over open `asset_reference` edges of the drafts (`REFERENCE`), the
  folders/record sets they sit in when not released at all (`CONTAINER`), a selected set's unreleased records
  (`SET_MEMBER`), and a selected changed folder's changed descendants (`DESCENDANT`, `includedByDefault = false`); one
  visit per (asset, locale), so cycles end. A dependency keyed `""` (non-localized media) is proposed once for any locale.
- **Summary entries** gained `locale` and `releasedVersion` (`AssetChange` has two more components with a backward
  compatible constructor).
- **Tests:** `ReleaseServiceIntegrationTest` (13: revisions and change types, no-op, completeness refusal, every
  validation code, editor 403 and archived 409, closure incl. transitive links, containers, set members and a published
  dependency left out, cycles, locale discard with `sharedFieldsKept`, discard of move/rename/delete in one revision,
  deletion semantics, structural draft keeps the old folder, carry-forward on the localizable toggle, project restore)
  and a new jqwik property in `RevisionInvariantsTest` (random edit/release/unpublish/discard sequences vs. a model of
  `ReleaseStates.at` at every revision).
