# Feature: Extended jobs — run retention, variant backfill, search maintenance

**Spec:** Extends §18.5 (generation run record), §11.4 (variants), §26.2/M23 (search index).

## Goal

- Generation run history stays bounded without breaking rollback or incremental baselines.
- Image variants that failed, or that a policy change added, are produced without touching content history.
- Each project's search index is checked and repaired regularly.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-generation-run-retention.md](001-generation-run-retention.md) | `M29.1.1`, `M29.2.1`, `M29.2.2` |
| 2 | [002-media-variant-backfill.md](002-media-variant-backfill.md) | `M29.1.1` |
| 3 | [003-search-index-maintenance.md](003-search-index-maintenance.md) | `M29.1.1` |

## Feature exit criteria

- [x] Old unprotected runs are deleted with their plans. Promote, incremental baselines and schedule histories still
      resolve.
- [x] Missing variants appear in `media_variant` without a revision, and preview, generation and export use them.
- [x] Search maintenance repairs lag and count mismatches, and merges when deletes pile up.

## Dependencies

`M29.1.1`; run retention also needs `M29.2.1` (no stale `RUNNING`) and `M29.2.2` (build directories reflect published
runs).
