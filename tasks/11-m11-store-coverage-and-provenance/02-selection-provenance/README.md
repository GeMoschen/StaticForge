# Feature: Selection provenance

**Spec:** New capability, extending `M10.1`'s selective export and `M10.2`'s
conflict detection — records *why* each asset is in an archive (explicitly
picked vs. implicitly pulled in as ancestor-chain padding), and lets import
treat the two differently.

## Goal

`resolveIncludedAssetIds` (`M10.1.1`) already computes two distinct sets
internally before merging them: the caller's explicit picks (expanded through
folder subtrees) and the ancestor folders added purely to keep
`parentFolderUuid` chains valid — the latter is padding the user never asked
for. Surface that distinction in the archive itself, and let import skip
re-creating an implicit ancestor when it already exists in the target
project (instead of either erroring on it or silently minting a duplicate
identity for it), while leaving explicitly-picked elements exactly as
`M9.3.1`/`M10.2` already handle them.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-explicit-implicit-tracking.md](001-explicit-implicit-tracking.md) | `M11.1.3` |
| 2 | [002-skip-existing-implicit-on-import.md](002-skip-existing-implicit-on-import.md) | 1 |

## Feature exit criteria

- [ ] Every `ExportedAsset` in an archive records whether it was explicitly
      picked or implicitly included.
- [ ] `importProject` (and `analyzeImport`, kept in lockstep per `M10.2.2`'s
      own "one detection path" principle) accept an opt-in that skips
      re-creating an implicit element already present in the target project,
      without changing how explicit elements are handled.

## Dependencies

`M10.1` (`ExportSelection`, `resolveIncludedAssetIds`), `M10.2` (`ConflictReport`,
`ConflictType.DUPLICATE_UUID`, `importProject`'s existing conflict guard),
`M9.3.1` (preserve-or-remap-on-collision, which stays the default and only
behavior for explicit elements). `M11.1.3` (`fullStores` expansion must also
be classified as explicit — see `M11.2.1`).
