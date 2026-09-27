---
id: M29.2.4
status: done
depends: [M29.1.1]
epic: m29-housekeeping-jobs
feature: core-jobs
area: backend
---

# M29.2.4 — Audit purge, refresh-token cleanup, in-memory eviction

## Context

- `AuditService` / `AuditServiceImpl` (Javadoc: no purge), `AuditLogRepository`, index `idx_audit_log_created`
  (`011-audit-log.xml`).
- `RefreshToken` (`revoked`, `expires_at`, `absolute_expires_at`, `family_id`), `RefreshTokenRepository`, and
  `RefreshTokenService.rotate` (a revoked token presented again → the family is deleted: **reuse detection needs
  revoked rows of live families**).
- `LoginAttemptService.buckets` (`sf-api/.../security/LoginAttemptService.java:48`, removed only on success, `WINDOW`
  5 min).
- `GenerationService.idempotencyKeys` (`:114`).
- Epic findings 6–8.

## Goals

- **Job `audit-purge`** (default `0 4 * * *`, settings `retentionDays` = 365 (minimum 30), `batchSize` = 5000, dry
  run): deletes entries with `created_at` older than the retention, in batches.
  - Report: the count per action and the oldest remaining entry.
  - The job's own settings changes are audited like every job's (`JOB_SETTINGS_SET`), so lowering the retention leaves
    a trace that the purge itself can't remove until it ages out.
- **Job `refresh-token-cleanup`** (default `15 * * * *`) deletes whole families where:
  - every row's `absolute_expires_at` < now, or
  - every row is revoked or expired (`expires_at` < now) and the newest row's `expires_at` is older than
    `reuseWindow` (default 7 days). Keeping them that long means a stolen token presented shortly after expiry is still
    recognized.

  Never delete single rows of a family that still has a usable token.
- **Job `memory-eviction`** (default `*/10 * * * *`):
  - `LoginAttemptService.evictIdle(now)` drops buckets whose newest attempt is older than `WINDOW` and that aren't
    blocked;
  - `GenerationService.evictIdempotencyKeys(olderThan)`, with a timestamp per key and a default TTL of 24 h
    (`sf.generate.idempotency-ttl`);
  - report sizes before and after.
- Update the `AuditService` Javadoc (retention enforced by `audit-purge`) and the `RefreshTokenService` Javadoc (the
  cleanup rule).

## Acceptance criteria

- [x] Audit: entries at 366 days are deleted and entries at 364 days kept. The dry run counts match. Instance and
      project entries are both handled.
- [x] Refresh tokens:
  - [x] a live family with revoked rows is kept, and presenting a revoked row still triggers reuse detection;
  - [x] a family past its absolute expiry is deleted;
  - [x] a family fully expired for longer than the reuse window is deleted.
- [x] Login limiter: after 10,000 distinct failed keys and one eviction past the window, the map is empty. A blocked key
      survives eviction until its block ends.
- [x] Idempotency: a key older than the TTL is evicted, and a re-submission with it starts a new run (documented
      behaviour).
- [x] `./gradlew build` green (audit purge and refresh-token cleanup part).

## Out of scope

- Per-project audit retention. Exporting the audit log before purging (a follow-up if compliance asks).

## Notes / hazards

- Delete in batches by id range, not one huge `DELETE`, so PostgreSQL WAL and locks stay small.
- The audit UI filter list (`actions()`) is derived from the DB, so purged actions disappear from it. That is expected.
- memory-eviction: done by B1 (`MemoryEvictionJob` in `sf-api`, package `com.acme.staticforge.housekeeping.memory`, no settings; `LoginAttemptService.evictIdle(now)`/`size()`; `GenerationService.evictIdempotencyKeys(olderThan)`, `idempotencyKeyCount()`, keys timestamped, `sf.generate.idempotency-ttl` default 24h; tests `LoginAttemptServiceTest`, `MemoryEvictionIntegrationTest`).

### Deviations

- **Split across streams:** this stream (B2) built `audit-purge` and `refresh-token-cleanup` and the Javadoc updates.
  The `memory-eviction` job (`LoginAttemptService.evictIdle`, `GenerationService.evictIdempotencyKeys`) was done by
  stream B1; its two checkboxes (login limiter, idempotency) are B1's.
- Packages `com.acme.staticforge.housekeeping.audit` (`AuditPurgeJob`, `AuditPurgeProperties`) and
  `com.acme.staticforge.housekeeping.tokens` (`RefreshTokenCleanupJob`, `RefreshTokenCleanupProperties`); defaults in
  `application.yml` (`sf.housekeeping.audit-purge.retention-days`/`batch-size`,
  `sf.housekeeping.refresh-token-cleanup.reuse-window`).
- `audit-purge` report: `byAction`, `instanceEntries`, `projectEntries`, `cutoff`, `oldestRemaining`, and a sample of
  up to 50 entries (id, action, project, time). Each batch selects the oldest `batchSize` expired ids and deletes that
  id range (re-checking `created_at`) in its own transaction.
- `refresh-token-cleanup` has no dry run (not in epic decision 4's list). It deletes up to 500 families per
  transaction and repeats the dead-family rule inside the `DELETE`, so a family rotated in between is not touched.
- **Bug fixed on the way:** `RefreshTokenService.rotate` threw its `401` inside the transaction that deleted the
  family, so the deletion of a reused (or expired) family was rolled back and the family stayed alive. It is now
  `@Transactional(noRollbackFor = SfException.class)`; the test asserts the family is gone after reuse detection.
- Tests: `AuditAndTokenCleanupJobsTest` (sf-app).
