---
id: M11.2.1
status: todo
depends: [M11.1.3]
epic: m11-store-coverage-and-provenance
feature: selection-provenance
area: backend
---

# M11.2.1 — Explicit vs. implicit provenance in the export archive

## Context

`ProjectExportImportServiceImpl.resolveIncludedAssetIds` builds two sets
before merging them into one included-id set: the caller's explicit picks
(direct UUIDs and folder-subtree expansions, and — after `M11.1.3` — `fullStores`
expansions) and a second `ancestors` set added afterward purely to keep
`parentFolderUuid` chains intact. That distinction is currently discarded
before `ExportedAsset`s are built. This task makes it durable.

## Goals

- `ExportedAsset` gains a new field, `boolean explicit`.
- `resolveIncludedAssetIds` (or a thin wrapper around it) exposes which ids
  ended up in the `ancestors` bucket specifically, so `exportSelection` can
  mark those `ExportedAsset`s `explicit=false` and every other included asset
  (direct picks, folder-subtree descendants, `fullStores` expansions,
  `exportProject`'s "everything" wrapper) `explicit=true`.
- Import-side: when parsing an archive whose `assets.json` predates this
  field (an `M10`-era export with no `explicit` key), treat the missing value
  as `explicit=true` — the safe default that reproduces exactly today's
  behavior (no asset is ever silently treated as skippable padding unless the
  exporter that produced it actually says so).

## Acceptance criteria

- [ ] Exporting a single deep page produces exactly one `explicit=true`
      entry (the page) and N `explicit=false` entries (its ancestor folder
      chain up to root).
- [ ] Exporting a folder (`M10.1.1`'s folder-selection case) marks the picked
      folder and every live descendant `explicit=true`; only folders *above*
      the picked one are `explicit=false`.
- [ ] A `fullStores` (`M11.1.3`) expansion marks every resulting asset
      `explicit=true` — picking "the whole store" is itself an explicit
      choice, not padding.
- [ ] `exportProject`'s "everything" wrapper marks every asset `explicit=true`
      (there is no padding to add when everything is already included).
- [ ] Parsing a pre-`M11` archive (no `explicit` field present) treats every
      asset as `explicit=true` without erroring.

## Out of scope

- Any change to import *behavior* based on this field — that's `M11.2.2`.
  This task only changes what gets recorded.

## Notes / hazards

- This is a purely additive archive-format change (a new optional JSON
  field) — it must not require a `PROTOCOL_VERSION` bump (`M10.2.2` already
  bumped it once for `settings.json`; don't bump it again for an optional,
  backward-compatible field older readers can simply ignore and older
  archives can simply omit).
