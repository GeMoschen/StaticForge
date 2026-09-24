---
id: M26.3.1
status: done
depends: [M26.1.2, M26.2.1]
epic: m26-user-management
feature: admin-api
area: backend
---

# M26.3.1 — Admin projects list and instance audit API

## Context

`AuditService` (today only `findRecent(projectId, pageable)`), `AuditController` (per project, `PROJECT_ADMIN`),
`AuditLog`, `ProjectService`, `ProjectMemberRepository`, revision head lookup. Epic decisions 12, 14.

## Goals

- `GET /admin/projects?includeArchived=true&q=` — every project: key, name, description, archived, createdAt,
  memberCount, headRevision and its timestamp (last change). Sorted by key.
- `GET /admin/audit?action=&userId=&project=&from=&to=&page=&size=` — every audit entry, newest first.
  `project` is a project key or `_instance` for entries without a project; `action` accepts several values;
  `from`/`to` are ISO instants. Row: id, timestamp, action, actor (id, username — `Deleted user` for deleted),
  projectKey (or null), target, detail.
- `GET /admin/audit/actions` — the distinct action names present, for the filter dropdown.
- Both instance admin only. Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] API tests: filters individually and combined, paging stable, `_instance` filter, `403` for non-admins.
- [x] Member counts and last-change timestamps correct for a project with and without revisions after creation.
- [x] Query is index-backed: add indexes on `audit_log(created_at)` and `(action, created_at)` if missing (changelog,
      H2 + PostgreSQL) — check `011-audit-log.xml` first.
- [x] `./gradlew build` green.

## Out of scope

- Audit retention/purge (§26 "retained 1 year") — note in the Javadoc whether a purge job exists; don't add one here.

## Notes / hazards

- The project-level `AuditController` stays as is.
- Use a JPA `Specification` or a small criteria query for the optional filters; no string-built SQL.

## Implementation notes

- Domain: `AuditService.search(AuditFilter, Pageable)` (JPA `Specification`, always newest first by `created_at`
  then `id`, the request's sort is ignored) and `AuditService.actions()`; `ProjectOverviewService.overview(q,
  includeArchived)` — three queries (projects, member counts grouped by project, every project's head revision).
- API: `AdminProjectController` (`includeArchived` defaults to `true`, the admin sees everything), `AdminAuditController`
  (`action` repeatable, unknown `project` key → `404`, a malformed `from`/`to` → `400` with `field`, `size` ≤ 200). The
  actor name of a deleted account is its anonymized display name, `Deleted user`.
- Indexes: `idx_audit_log_created` existed (011); `019-user-management.xml` adds `(action, created_at)` and
  `(actor_user_id, created_at)` for the action and user filters.
- Retention: there is no purge job; the `AuditService` Javadoc says so.
- `docs/api.md` §14.1 lists the three endpoints (the rest of the M26 docs is `M26.5.1`).
