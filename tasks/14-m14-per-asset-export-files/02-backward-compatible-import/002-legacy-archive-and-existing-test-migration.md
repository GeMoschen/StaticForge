---
id: M14.2.2
status: todo
depends: [M14.2.1]
epic: m14-per-asset-export-files
feature: backward-compatible-import
area: qa
---

# M14.2.2 — Legacy-archive regression test, and migrate the existing test suite

## Context

Two things this task covers together, because they're two halves of the same claim
("the reader genuinely handles both shapes, and every test that already exercised the
old one still proves something real"): first, a dedicated test proving a legacy-shaped
archive imports correctly (mirroring `M9.3.2`'s and `M11.2.1`'s own precedent of
hand-constructing an old-format archive rather than trusting the claim by inspection);
second, updating every existing test that reads `assets.json` directly — chiefly
`ProjectExportImportIntegrationTest`'s `parseAssets` helper, used by dozens of existing
assertions throughout that file — so the whole suite exercises the new default shape
`M14.1` actually produces, not a shape no exporter has written since `M14.1.1` landed.

## Goals

- New test: export a fixture project normally (producing the new per-file shape), then
  build a legacy-shaped archive from that same asset data by repacking it into a single
  `assets.json` entry — `ExportArchive(2, assets)` (protocol version 2, the last
  version that ever wrote this shape), replacing the `assets/<uuid>.json` entries —
  mirroring the existing `rewriteAssetsJsonWithoutExplicitField`-style helper pattern
  already used in this test file (read every entry from the freshly-exported archive,
  rewrite the ones that need to change, write a new ZIP) for exactly this kind of
  "simulate an older archive shape by hand" case. Import the repacked archive into a
  fresh target project and assert the outcome (assets created, folder structure,
  `explicit` provenance, revision history) is identical to importing the same source
  project's normally-exported archive.
- Update `parseAssets` (and any other helper reading `assets.json`/ZIP entries directly
  in this or any other test file) to read the new per-file shape by default, since
  that's what `exportSelection` now actually writes — every test using it exercises
  real, current behavior again instead of a shape the production exporter no longer
  produces.
- Audit every call site of `parseAssets` in `ProjectExportImportIntegrationTest.java`
  (there are many — selection tests, provenance tests, conflict tests, `M13`'s
  template-folder tests) to confirm none of them made an assumption specific to the old
  single-array shape (e.g., ordering guarantees that happened to fall out of array
  order rather than the explicit post-read sort) that the new shape could silently
  violate.

## Acceptance criteria

- [ ] The new legacy-archive-repack test passes.
- [ ] `parseAssets` and every test using it work against the new per-file format with
      zero remaining references to the old single-`assets.json` shape as the *default*
      expectation (the only remaining `assets.json`-shaped fixture in the whole suite
      should be the one this task's own legacy-archive test deliberately constructs).
- [ ] Full `ProjectExportImportIntegrationTest` suite (and any other test file touching
      export/import archives) passes.
- [ ] `./gradlew :server:sf-app:test` (or the project's equivalent full backend test
      run) is green with no new failures.

## Out of scope

- Any new product behavior — this task, like `M9.3.2` before it, is a test-audit and
  regression-proof pass over an in-place format change to already-tested code, not new
  functionality.

## Notes / hazards

- This is the highest-value test in the epic — it's the one thing that proves a real
  operator's already-existing exported ZIPs (from any `M10`–`M13`-era server) keep
  working after an upgrade. Don't shortcut it in favor of only testing the new format's
  own happy path, the same caution `M13.4.1`'s migration-fixture test called out for
  itself.
- Keep the legacy-repack helper narrowly scoped to reversing exactly what `M14.1.1`
  changed (per-file → single array) — don't build a generic "convert archive between
  arbitrary protocol versions" utility; there's only ever one step to simulate here.
