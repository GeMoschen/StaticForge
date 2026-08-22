---
id: M1.3.3
status: done
depends: [M1.3.2]
epic: m1-identity-revisions
feature: asset-identity
area: backend
---

# M1.3.3 — UID rename operation

## Context

Implement the explicit "Change UID" action of §6.4, the only place `asset.uid` is
mutated, gated and history-tracked.

## Goals

- Implement `PATCH /assets/{uuid}/uid` (DEVELOPER/PROJECT_ADMIN), validating the new UID
  against the charset + uniqueness rules (§6.4).
- Allocate a new revision, write `asset_uid_history` (`asset_id, old_uid, new_uid,
  revision`), and update `asset.uid`.
- Emit a warning listing OCTL templates that reference the old UID literally (§6.4, §16.4).

## Acceptance criteria

- [ ] A rename creates a new revision + history row and leaves other assets' stored UUID
      references intact.
- [ ] The response includes the list of templates referencing the old UID (once OCTL
      references are indexed; stub-able before M2).

## Out of scope

- OCTL reference *scanning* detail (M2 materializes these); here rely on future
  `asset_reference` data or a placeholder query.

## Notes / hazards

- Rename does **not** recompute UID from display name; display-name changes never touch
  the UID (§6.4).
