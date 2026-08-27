---
id: M14.2.1
status: todo
depends: []
epic: m14-per-asset-export-files
feature: backward-compatible-import
area: backend
---

# M14.2.1 — `readArchive` accepts both the per-file and legacy single-file shapes

## Context

`ProjectExportImportServiceImpl.readArchive` currently has one branch for assets:
`else if (ASSETS_ENTRY.equals(name)) { assets = new ArrayList<>(objectMapper.readValue(
zip.readAllBytes(), ExportArchive.class).assets()); }`, inside the `while ((entry =
zip.getNextEntry()) != null)` loop that already handles `MANIFEST_ENTRY`/
`SETTINGS_ENTRY`/`BLOBS_PREFIX`-prefixed entries generically. This task adds a second
branch for `ASSETS_PREFIX`-prefixed entries (`M14.1.1`) that accumulates individual
`ExportedAsset`s instead of reading one combined array.

## Goals

- In the same entry-reading loop, add: `else if (name.startsWith(ASSETS_PREFIX)) {
  (create the assets list on first use).add(objectMapper.readValue(zip.readAllBytes(),
  ExportedAsset.class)); }` — mirroring exactly how the existing `BLOBS_PREFIX` branch
  already accumulates into a map entry-by-entry in this same loop.
- Keep the existing `ASSETS_ENTRY` branch exactly as-is for the legacy shape — do not
  merge the two branches or try to detect shape before the loop finishes; both are
  simple, independent accumulators over the same one pass through the ZIP's entries,
  and only one of them will ever end up non-empty for any real archive (an archive is
  written by exactly one version of the exporter, so it only ever has one shape).
- After the loop, `assets` is the union: if the legacy branch populated a list, that
  list is what downstream code uses; if the per-file branch populated one, that one is
  used instead. Keep the existing `if (manifest == null || assets == null)` guard
  (rephrase only if needed so it still means "no asset data of either shape was
  found").
- No change to `manifest.protocolVersion() > PROTOCOL_VERSION` mismatch handling
  (`M10.2.2`'s existing guard) — that check is about refusing an archive from a
  *newer* server than this one, which is completely orthogonal to which of the two
  *older-or-current* shapes an accepted archive uses.

## Acceptance criteria

- [ ] An archive containing `assets/<uuid>.json` entries (no `assets.json`) is read
      correctly into the same `List<ExportedAsset>` shape `readArchive` always
      produced.
- [ ] An archive containing a single `assets.json` entry (no `assets/` entries) is
      still read correctly, unchanged from today's behavior.
- [ ] `assets.sort(Comparator.comparing(ExportedAsset::uuid))` (the existing
      post-loop sort already present in `readArchive`) still runs on the result
      regardless of which branch populated it, so downstream ordering guarantees are
      unaffected by which shape was read.

## Out of scope

- The write side — already done, `M14.1.1`.
- Proving a *hand-repacked* legacy archive actually round-trips through the full
  import (not just the reader in isolation) — `M14.2.2`.

## Notes / hazards

- Don't attempt to detect "shape" from `manifest.protocolVersion()` as the primary
  signal — trust the entry names, which are unambiguous and can't drift from what's
  actually in the ZIP the way a metadata field theoretically could. `protocolVersion`
  stays useful for the *newer-than-us* rejection case, not for this decision.
- If a malformed/hand-edited archive somehow contains both an `assets.json` entry and
  `assets/` entries, don't spend effort reconciling them — this can't happen from any
  real exporter this codebase has ever shipped, so it's fine for the per-file branch's
  result to simply win if both ended up non-empty (last-applied-wins, no explicit merge
  logic needed); not worth a dedicated error path for a shape no writer produces.
