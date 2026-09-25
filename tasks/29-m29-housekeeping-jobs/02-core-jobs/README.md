# Feature: Core jobs — recovery, build output, blobs, audit, tokens, memory

**Spec:** Extends §11.2 (blob store sweep), §18.4–§18.5 (builds, runs, cancel), §26.3 (audit retention), §9
(refresh tokens), §26.5 (backup and recovery).

## Goal

These jobs cover what the spec promises and what makes a crashed or long-running instance unhealthy:

- interrupted runs no longer block projects, and cancel really cancels;
- failed builds no longer eat disk space or rollback slots;
- unreferenced blobs are collected safely;
- the audit log and refresh tokens are purged;
- in-memory maps stop growing.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-generation-run-recovery-and-real-cancel.md](001-generation-run-recovery-and-real-cancel.md) | `M29.1.1` |
| 2 | [002-build-output-cleanup.md](002-build-output-cleanup.md) | 1 |
| 3 | [003-blob-sweep.md](003-blob-sweep.md) | `M29.1.1`, `M27.3.1` (localized media payload) |
| 4 | [004-audit-token-and-memory-cleanup.md](004-audit-token-and-memory-cleanup.md) | `M29.1.1` |

Tasks 3 and 4 are independent of 1 and 2.

## Feature exit criteria

- [ ] A run interrupted by a restart is `FAILED` (`SF-GEN-0504`), and the project can build again. A cancelled run
      never publishes.
- [ ] Staged output of failed/cancelled/interrupted runs, stale temp links and deleted targets' directories are
      removed. `keep-builds` counts published builds only, and a failed run can't be promoted.
- [ ] The blob sweep deletes exactly the unreachable blobs older than the grace period, including orphan store
      objects, on both stores. `ref_count` is recomputed.
- [ ] Audit entries past retention and dead refresh-token families are deleted; login-limiter and idempotency maps stay
      bounded.

## Dependencies

`M29.1.1`; `M27` feature 3 for the localized-media payload keys the blob mark must follow.
