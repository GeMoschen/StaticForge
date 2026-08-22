---
id: M1.6.2
status: done
depends: [M1.6.1]
epic: m1-identity-revisions
feature: diff-restore
area: backend
---

# M1.6.2 — Restore API (asset & project-wide)

## Context

Implement append-only restore per §7.6: history is never rewritten, restoring is a new
write.

## Goals

- Implement `POST /assets/{uuid}/restore?fromRevision=R` — writes that revision's payload
  as a new revision.
- Implement `POST /projects/{p}/restore?toRevision=R` — project-wide rollback as one bulk
  restore revision, `PROJECT_ADMIN` only, requiring explicit typed confirmation.
- Record `RESTORE` change type in the revision.

## Acceptance criteria

- [ ] Restore produces a new revision; the past is unchanged.
- [ ] Project rollback is gated to `PROJECT_ADMIN` and bulk-restores atomically.

## Out of scope

- Confirmation UI (M6).

## Notes / hazards

- Restore must go through the same `RevisionService.allocate` path.
