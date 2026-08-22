---
id: M1.1.1
status: done
depends: [M0.3.2]
epic: m1-identity-revisions
feature: project-domain
area: backend
---

# M1.1.1 — User, Project, Membership entities & repositories

## Context

Create the persistence core for §8.1 (project), §8.2 (app_user), §8.3 (project_member),
and add the matching Liquibase changesets (they extend the M0 baseline).

## Goals

- Implement entities exactly per §8: `project` (key unique, name, description, archived,
  created_at/by), `app_user` (username/email unique, display_name, BCrypt `password_hash`,
  `status`, `system_role` USER|INSTANCE_ADMIN, lock fields, `token_epoch`), and
  `project_member` (composite PK `(project_id, user_id)`, `role`, `granted_*`).
- Add Liquibase changesets for these tables (v1.0 continuation), following §22.4 rules.
- Write repositories where **every** query filters by `project_id` (§8.1) — no
  cross-project read methods except an instance-admin report seam.

## Acceptance criteria

- [ ] Entities map cleanly; `ddl-auto: validate` passes.
- [ ] `project.key` and `app_user.username`/`email` unique constraints are enforced.
- [ ] A repository test proves queries are scoped to `project_id`.

## Out of scope

- Services/authorization (next tasks).
- Password hashing policy details beyond storage field.

## Notes / hazards

- `token_epoch` (§9.2) must exist now even though it's used by auth in the next feature.
