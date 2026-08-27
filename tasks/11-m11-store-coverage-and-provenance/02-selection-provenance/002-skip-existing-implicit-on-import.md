---
id: M11.2.2
status: todo
depends: [M11.2.1]
epic: m11-store-coverage-and-provenance
feature: selection-provenance
area: backend
---

# M11.2.2 — Import option: skip already-existing implicit elements

## Context

Today every UUID collision on import — explicit or implicit — takes the same
path: `M9.3.1`'s per-asset "mint a fresh UUID on collision, preserve
otherwise." For an *implicit* ancestor folder (`M11.2.1`), minting a fresh
UUID when the target project already has that exact folder (e.g. both
projects seeded from a shared parent, or a prior partial import) creates a
needless duplicate folder subtree instead of reusing what's already there.
This task adds an opt-in that changes resolution specifically for
`explicit=false` assets, leaving explicit assets completely untouched.

`M10.2.3`'s commit endpoint already independently re-validates blocking
conflicts inside `importProject` itself (not the controller), and
`importProject` already carves `DUPLICATE_UUID` out of the set of conflict
types that actually abort a commit (see `M10.2.2`'s design note: minting a
fresh UUID is `DUPLICATE_UUID`'s own established, safe resolution). This
task extends that same carve-out mechanism for the new option rather than
adding a second, parallel one.

## Goals

- `importProject` gains a new option, e.g. `boolean skipExistingImplicit`
  (default `false`, so today's behavior is exactly preserved when the option
  isn't passed) — add it as a parameter (or fold it into a small new
  `ImportOptions` record alongside `RevisionContext` if that reads more
  naturally given the method's current signature; pick whichever keeps the
  method signature least awkward).
- When `skipExistingImplicit` is `true`: for each `ExportedAsset` where
  `explicit() == false` and `assetRepository.findByProjectIdAndUuid(targetProjectId,
  uuid).isPresent()`, do **not** create a new asset for it — instead point
  its `remap`/`idMaps` entry at the *existing* target asset's id/uuid, so
  every descendant that references it via `parentFolderUuid` resolves
  correctly against the pre-existing folder. `explicit=true` assets are
  completely unaffected by this option in every case.
- `analyzeImport` also accepts the option (kept in lockstep with
  `importProject` per `M10.2.2`'s "one detection path" principle — the report
  must reflect what will actually happen). When the option is set, a
  `DUPLICATE_UUID` conflict whose `elementUuid` corresponds to an
  `explicit=false` asset is no longer treated as blocking in the returned
  `ConflictReport` (it becomes informational, or is omitted — pick whichever
  is simpler to implement correctly, and document the choice); the same
  conflict on an `explicit=true` asset is never affected by the option.

## Acceptance criteria

- [ ] Importing an archive whose implicit ancestor folder already exists in
      the target (identical UUID) with the option **on** creates zero
      duplicate folders and correctly parents the explicit descendants under
      the existing one.
- [ ] The same archive with the option **off** (default) behaves exactly as
      before `M11` (mints a fresh UUID for the colliding folder, per
      `M9.3.1`).
- [ ] An **explicit** asset that collides is never silently skipped by this
      option, regardless of its setting — it always goes through the normal
      `M9.3.1` collision path.
- [ ] `analyzeImport` with the option set no longer reports a blocking
      `DUPLICATE_UUID` for an implicit collision; with the option unset, it
      reports it exactly as `M10.2.2` already does today.

## Out of scope

- Any change to `DUPLICATE_UUID`'s fixed severity on `ConflictType`
  (`M10.2.1`) — it stays `BLOCKING` by default; this option only changes
  whether one specific, already-safe-to-auto-resolve instance of it is
  surfaced as blocking, the same way `importProject`'s existing carve-out
  already does for `DUPLICATE_UUID` in general.
- Any new conflict-resolution UI beyond the single on/off option — still
  report-then-accept-or-cancel, per `M10`'s own scope boundary.

## Notes / hazards

- Keep the "is this asset's collision skippable" check keyed off
  `explicit()`, not off `ConflictType` alone — an implicit asset that
  *doesn't* collide is completely unaffected either way, and an explicit
  asset must never be eligible for skipping no matter what type of conflict
  it triggers.
