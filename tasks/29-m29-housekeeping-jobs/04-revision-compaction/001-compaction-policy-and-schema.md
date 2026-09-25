---
id: M29.4.1
status: todo
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

- [ ] API tests: enable without or with a wrong confirm → `422 SF-DOM-0182`; `olderThanDays = 29` → `422 SF-DOM-0183`;
      enable/disable round trip; `403` for `DEVELOPER`; archived → `409`; audit entry written.
- [ ] Liquibase changeset applies on H2 and PostgreSQL. Existing revisions get `compacted = false`.
- [ ] `./gradlew build` green.

## Out of scope

- The algorithm and job (`M29.4.2`) and the read-side flags (`M29.4.3`).

## Notes / hazards

- The export archive doesn't carry `compaction_policy`. It is an operational setting of the instance, not content.
  Say so in the export docs.
