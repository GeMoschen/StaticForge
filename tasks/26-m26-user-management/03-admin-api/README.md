# Feature: Admin API — projects overview and instance audit

**Spec:** Extends §8.1, §20.2, §26 (audit, retained 1 year).

## Goal

Give the admin area its two remaining data sources: all projects with their state, and every audit entry across
the instance.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-admin-projects-and-audit-api.md](001-admin-projects-and-audit-api.md) | `M26.1.2`, `M26.2.1` |

## Feature exit criteria

- [x] `GET /admin/projects` and `GET /admin/audit` with filters and paging, instance admin only.

## Dependencies

`M26.1.2` (admin controller conventions, audit actions), `M26.2.1` (archived state, unarchive).
