---
id: M29.4.1
status: done
depends: [M29.1.1, M27.1.1]
epic: m29-housekeeping-jobs
feature: revision-compaction
area: backend
---

# M29.4.1 — Compaction policy and schema

## Context

- `Project` (`allowed_mime_types`, `locale_config` json; M28 adds `publish_policy` json).
- `ProjectController` (`PUT /projects/{key}` PROJECT_ADMIN at `:107`, locales `:123`).
- `Revision` (`sf-domain/.../revision/Revision.java`, composite key `(projectId, revisionId)`, summary JSON).
- `ProjectWriteGuard.requireWritable` (M26 archived guard) and `AuditService`.
- `sf.revision.retention-days` (`application.yml:78`, unread).
- Epic decision 13.

## Goals

- **Schema** (`025-revision-compaction.xml`):
  - `project.compaction_policy` JSON (null = off);
  - `project.compacted_through` BIGINT (null);
  - `revision.compacted` BOOLEAN NOT NULL DEFAULT false;
  - `asset_version.original_valid_from` BIGINT (null). It is set by compaction when a survivor's `valid_from_revision`
    is moved back, and it drives the exact per-asset `compacted` flag on reads (`M29.4.3`).
- **Policy** `CompactionPolicy` record: `enabled`, `olderThanDays` (≥ 30), `enabledAt`, `enabledBy`.
  - `GET /projects/{key}/compaction` (`PROJECT_ADMIN`) returns the policy plus `compactedThrough` and the last run
    summary for this project (from the job's per-project report, if any).
  - `PUT /projects/{key}/compaction?confirm=<projectKey>` (`PROJECT_ADMIN`):
    - body `{enabled, olderThanDays}`;
    - enabling, or lowering `olderThanDays`, requires `confirm` equal to the project key, otherwise
      `422 SF-DOM-0182`;
    - `olderThanDays < 30` → `422 SF-DOM-0183`;
    - disabling or raising needs no confirmation;
    - archived project → `409 SF-DOM-0141` via the guard;
    - audits `COMPACTION_POLICY_SET` (before/after). No revision.
- **Estimate.** `GET /projects/{key}/compaction/estimate?olderThanDays=N` is read-only and allowed on archived projects
  (`@AllowedOnArchivedProject`). It returns the versions in the window, the versions that would be removed (the
  decision 13 rules, computed by the algorithm of `M29.4.2` in dry-run mode) and an estimate of the bytes of payload
  freed. It is used by the UI confirmation dialog.
  - If `M29.4.2` isn't merged yet, the endpoint lands with that task. Keep it in this task's API contract and mark it
    done there.
- Remove `sf.revision.retention-days` from `application.yml` (unused, misleading), or map it to nothing with a comment
  pointing at the per-project policy. Prefer removing it.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] API tests: enable without or with a wrong confirm → `422 SF-DOM-0182`; `olderThanDays = 29` → `422 SF-DOM-0183`;
      enable/disable round trip; `403` for `DEVELOPER`; archived → `409`; audit entry written (`CompactionPolicyApiTest`).
- [x] Liquibase changeset applies on H2 and PostgreSQL. Existing revisions get `compacted = false` (proven on H2; the
      PostgreSQL changeset mirrors 017's JSONB column, no PostgreSQL on this machine).
- [x] `./gradlew build` green (server `test --rerun`).

## Out of scope

- The algorithm and job (`M29.4.2`) and the read-side flags (`M29.4.3`).

## Notes / hazards

- The export archive doesn't carry `compaction_policy`. It is an operational setting of the instance, not content.
  Say so in the export docs.

### Deviations

- **Changelog `027-revision-compaction.xml`**, not `025`: `024`–`026` were taken (M27.8, M28, M29.1.1).
- **The estimate endpoint** landed with `M29.4.2` (same commit): `GET /projects/{key}/compaction/estimate?olderThanDays=N`
  (`PROJECT_ADMIN`, `@AllowedOnArchivedProject`) runs `RevisionCompactor.compact(…, dryRun = true)` with the cutoff
  "now − N days" and answers `{olderThanDays, cutoff, versionsInWindow, versionsRemoved, assetsTouched,
  referencesRewritten, revisionsMarked, bytesFreed}`; `N < 30` is `422 SF-DOM-0183`.
- **API shape.** `GET`/`PUT /projects/{key}/compaction` answer `CompactionPolicyView` `{enabled, olderThanDays,
  enabledAt, enabledBy, compactedThrough, lastRun}`; `lastRun` is `{runId, finishedAt, dryRun, outcome, cutoff, error,
  versionsInWindow, assetsTouched, versionsRemoved, referencesRewritten, revisionsMarked, bytesFreed}` from the newest of
  the job's last 50 runs that reports on the project, or `null`. `GET` is `PROJECT_ADMIN` like `PUT`.
- **Policy rules.** `olderThanDays` omitted keeps the current value (90 for a project that never set one). Enabling or
  lowering while enabled needs `confirm`; raising keeps `enabledAt`/`enabledBy`; disabling stores `{enabled: false,
  olderThanDays, enabledAt: null, enabledBy: null}`. An unchanged policy records nothing (no audit entry). `0183` is
  checked before `0182`.
- **Read-only mappings.** `project.compacted_through`, `revision.compacted` and `asset_version.original_valid_from` are
  mapped `insertable = false, updatable = false` (written only by `RevisionCompactor` via JDBC), so an entity save can
  never overwrite them. `valid_from_revision` of `asset_version` and `asset_reference` became `updatable = false` (it
  never had a setter): a stale entity flushed by a concurrent save can't undo a compaction.
- `sf.revision.retention-days` removed from `application.yml`; the job's block `sf.housekeeping.revision-compaction`
  (`enabled`, `cron`, `batch-assets`) documents the defaults instead.
- The export note is in `docs/user-guide.md` ("Compaction and exports"); the full docs follow in `M29.6.1`.
- `schema.d.ts` is not regenerated here: the coordinator regenerates it after merging the M29 streams.
