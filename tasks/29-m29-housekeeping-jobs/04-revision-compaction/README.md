# Feature: Revision compaction (spec §7.7)

**Spec:** Implements §7.7 (reserved until now), extends §7.4 (version intervals), §7.6 (diff and restore), §25.5
(revision invariants), §26.5.

## Goal

Projects with long histories can opt in to collapsing old versions to the last version of each day, on the rules of
epic decision 13. Every version that a release, a retained build or a pending schedule depends on survives, and every
read stays defined and explained.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-compaction-policy-and-schema.md](001-compaction-policy-and-schema.md) | `M29.1.1`, `M27.1.1` |
| 2 | [002-compaction-algorithm-and-job.md](002-compaction-algorithm-and-job.md) | 1, `M29.2.2` |
| 3 | [003-compacted-history-reads.md](003-compacted-history-reads.md) | 2 |

## Feature exit criteria

- [x] A project admin enables compaction with a typed confirmation (`older than` ≥ 30 days). It is audited, and
      refused on archived projects.
- [x] The weekly job compacts opted-in projects exactly per decision 13.
- [x] Extended property-based invariants hold, and a rebuild at a released or retained-build revision is byte-identical
      before and after.
- [x] Time travel and diff at compacted revisions answer with `compacted: true`, and the diff explains that exact
      changes were compacted.

## Dependencies

- `M29.1.1` (job framework).
- `M27.1.1` (`asset_release` — protected versions).
- `M27.4.x` (pinned schedules — protected versions).
- `M29.2.2` (the retained-build listing is reliable: published builds only).
