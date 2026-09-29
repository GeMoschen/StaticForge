---
id: M32.5
status: done
depends: [M32.3]
epic: m32-complete-url-registry
feature: planner-redirects-removal
area: backend
---

# M32.5 — Planner, redirects and removal

## Context

`BuildPlanner.moved`, `RebuildExpansion`, `RebuildEdgeKind`, `ImpactService`, revision summaries (as `CHANNEL` entries
for channel changes), `BuildRedirects` (AUTO redirects, shadowing), `AssetServiceImpl.softDelete`, release /
unpublish services (M27), pagination fan-out. Epic decisions 5, 7, 8; user decisions 11, 13.

## Goals

- An override, a reset or an import records a `url_registry_change` row. The next INCREMENTAL build makes the target
  a root of kind `RebuildRootKind.URL_CHANGED` (pages and media by comparing paths with the base manifest, folders by
  the change log): it re-renders the target, its linkers and navigation. No FULL build is forced.
- A reset deletes the row; the next build assigns the currently computed path and writes the file there.
- `BuildRedirects` emits an AUTO redirect from the old registered URL to the new one (shadowing as in M30).
- Removal: deleting or unpublishing an asset, or withdrawing its release in a locale, deletes its computed rows
  (both areas; only that locale for a locale withdrawal); overrides stay. A paginated page whose page count shrank
  loses the computed rows above the new count.
- Rebuild reasons show `URL_CHANGED`.

## Acceptance criteria

- [x] Incremental test: override a page URL → the page, its linkers and navigation re-render, nothing else; file moved;
      AUTO redirect old → new.
- [x] Move a page, then reset its row → incremental build moves the file and emits the AUTO redirect; before the reset
      nothing re-renders for the move.
- [x] Media override re-renders every page linking the media.
- [x] Delete / unpublish / locale withdrawal remove computed rows, keep overrides; restoring gets the override back.
- [x] Page count shrinking from 4 to 2 removes computed rows for pages 3 and 4.
- [x] `./gradlew build` green.

## Out of scope

- Export/import (M32.6), REST (M32.7).

## Notes / hazards

- Check that a page move without a reset no longer counts as `outputMoved` (the output doesn't move any more); the M31
  rule "moved outputs re-render navigation" must follow the registry, not the computed path.
- Verify where the build cleans up outputs no longer in the plan; GENERATED rows of targets that left the plan are
  deleted there (computed only) unless the asset is merely unchanged in an incremental run.
