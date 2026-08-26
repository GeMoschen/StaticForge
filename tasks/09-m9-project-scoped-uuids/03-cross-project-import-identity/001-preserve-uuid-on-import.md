---
id: M9.3.1
status: todo
depends: [M9.1.2, M9.2.1]
epic: m9-project-scoped-uuids
feature: cross-project-import-identity
area: backend
---

# M9.3.1 — Preserve source UUID on import when possible

## Context

`ProjectExportImportServiceImpl.importProject` currently builds `remap` by generating
a fresh `UuidV7` for every single `ExportedAsset` unconditionally:

```java
Map<String, UUID> remap = new HashMap<>();
for (ExportedAsset asset : assets) {
    remap.put(asset.uuid().toLowerCase(), UuidV7.generate());
}
```

With uniqueness now per-project (`M9.1`), this is stricter than necessary — a fresh
UUID is only needed for an asset whose source UUID already exists in the target
project.

## Goals

- Change the `remap` construction: for each `ExportedAsset`, check
  `assetRepository.findByProjectIdAndUuid(targetProjectId, UUID.fromString(asset.uuid()))`
  (from `M9.1.2`). If absent, `remap.put(asset.uuid().toLowerCase(),
  UUID.fromString(asset.uuid()))` (preserve). If present, mint a fresh `UuidV7` as
  today (collision path).
- The root-folder special case (`findRootFolder`/`ensureRootFolder`) stays as-is —
  every project already has exactly one root folder with a fixed `uid` ("root"); it is
  never subject to UUID preservation since it's resolved by `uid`, not carried across
  as a new element.
- `payload.origin` provenance gains the collision outcome for observability: keep the
  existing `from`/`sourceProjectKey`/`importedAt` fields, and where a fresh UUID *was*
  minted (the collision path), also record the original source UUID
  (`origin.sourceUuid`) so a human inspecting an asset's history can tell it was
  re-keyed on import — this is metadata for debugging/audit, not something any code
  path depends on for correctness (that's the DB-level existence check).
- `UuidRemapper.remap(...)` (reference rewriting inside payloads) is unaffected in
  mechanism — it still walks the `remap` map — it just now often maps a UUID to
  itself, which is a correct no-op remap.

## Acceptance criteria

- [ ] Importing an archive into a project with none of its UUIDs present: every
      imported asset's UUID in the target database equals its `ExportedAsset.uuid`
      exactly (byte-for-byte, not just "a new UUID").
- [ ] Importing an archive into a project where every one of its UUIDs is already
      present: every imported asset gets a fresh UUID (today's behavior, unchanged for
      this specific case) and all internal references (template refs, media refs,
      folder parents) remap consistently to the new UUIDs — no dangling references to
      the old ones.
- [ ] Importing an archive into a project where *some* UUIDs collide and others don't:
      each asset is handled independently per its own collision status, and
      cross-references between a preserved-UUID asset and a remapped-UUID asset still
      resolve correctly after import.
- [ ] Re-running `RevisionInvariantsTest`/whatever existing exportimport integration
      tests cover this path (updated per `M9.3.2`) passes.

## Out of scope

- The conflict report / analyze-before-commit UX (`M10.2`) — this task only changes
  what `importProject` actually does; surfacing the collision to a user ahead of time
  is `M10`'s job.

## Notes / hazards

- Do this check per-asset, not as a single "does any UUID collide" project-wide gate —
  partial preservation (some assets keep their identity, only the colliding ones get
  remapped) is the whole point; an all-or-nothing gate would defeat cross-project
  identity for every asset just because one page happens to already exist.
- Double check `findRootFolder`'s `ROOT_UID` special case still short-circuits before
  this new per-asset check runs — the root folder should never go through the
  collision path since `ensureRootFolder` already handles it via `uid`, not via the
  generic remap loop.
