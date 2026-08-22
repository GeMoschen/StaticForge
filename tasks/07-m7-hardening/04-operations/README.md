# Feature: Operations (backup, export/import, runbooks)

**Spec:** §26.5 (backup/recovery), §26.6 (operations).
**Area:** infra. **Epic:** M7.

## Goal

Deliver backup/recovery, project export/import, and deploy runbooks.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-export-import.md](001-export-import.md) | M4.3.2 |
| 2 | [002-backup-recovery-runbooks.md](002-backup-recovery-runbooks.md) | 1 |

## Feature exit criteria

- [ ] Project export/import (ZIP) round-trips assets/blobs/manifest.
- [ ] Backup + zero-downtime deploy runbooks exist; quarterly restore drill documented.

## Dependencies

`M4:targets` (ZIP), all prior epics.
