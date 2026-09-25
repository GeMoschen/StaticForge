# Feature: Released rendering — generation renders released versions, preview renders drafts

**Spec:** Extends §16.4 (references), §17 (navigation), §18.1–§18.2 (SNAPSHOT, PLAN), §19 (preview, share links).

## Goal

A build renders exactly the release state at its revision — per locale — and incremental builds rebuild what a
release changed. Preview shows the draft by default and the released state on demand.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-released-snapshot.md](001-released-snapshot.md) | `M27.1.1` |
| 2 | [002-incremental-planning-on-release.md](002-incremental-planning-on-release.md) | 1, `M27.1.2` |
| 3 | [003-preview-draft-and-published.md](003-preview-draft-and-published.md) | 1 |

Tasks 2 and 3 can run in parallel.

## Feature exit criteria

- [x] A full build after the migration is byte-identical to the build before it (golden comparison on the existing
      generation fixtures, with and without locales).
- [x] Unreleased assets are absent everywhere a tombstone is absent; references to them render empty with `SF-GEN-0221`.
- [x] Per-locale: DE and EN render different released versions of one page.
- [x] Incremental builds are seeded by release changes, not by saves.
- [x] Preview draft/published views and share-link views work.
- [x] `./gradlew build` green.

## Dependencies

`M27.1.1`/`M27.1.2`, `M22` (`BuildPlanner`, `RebuildExpansion`, reason chains, `BuildManifest`, `CarryForward`),
`M24` (per-locale fan-out), `M18` (processed text media in preview), `M21` (`SnapshotPagination`).
