---
id: M1.4.2
status: done
depends: [M1.4.1]
epic: m1-identity-revisions
feature: revision
area: backend
---

# M1.4.2 — RevisionService & RevisionContext

## Context

Enforce the "one mutation ⇒ one revision ⇒ one transaction" invariant via a single,
un-bypassable service entry point (§7.1, §21.2).

## Goals

- Implement `RevisionService` with `allocate(long projectId, ChangeType, comment,
  userId)` and `appendSummary(...)` per §21.3.
- Introduce `RevisionContext` (project, user, comment) that every mutating service
  method takes and uses to call `revisionService.allocate(...)` **first**.
- Add the ArchUnit rule (§21.2): no repository save/delete may be called outside a class
  annotated `@RevisionAware`.

## Acceptance criteria

- [ ] `allocate` returns the fresh revision id; summary appends are denormalized.
- [ ] The ArchUnit rule fails the build when a repo write bypasses `@RevisionAware`.
- [ ] A mutating service that omits allocation cannot compile/run (enforced).

## Out of scope

- Diff computation (feature 6).

## Notes / hazards

- Keep allocation cheap; target < 50 ms content-save transaction (§7.3).
