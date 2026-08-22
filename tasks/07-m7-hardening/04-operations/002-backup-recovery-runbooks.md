---
id: M7.4.2
status: done
depends: [M7.4.1]
epic: m7-hardening
feature: operations
area: infra
---

# M7.4.2 — Backup, recovery & deploy runbooks

## Context

Write the operational runbooks of §26.5/§26.6.

## Goals

- Postgres backup (nightly base + WAL archiving, PITR RPO 5 min / RTO 1 h) + blob store
  (versioned bucket / rsync) runbooks.
- Zero-downtime deploy procedure (expand → migrate → contract for destructive changesets).
- Quarterly restore-drill runbook; blob-before-commit consistency note.

## Acceptance criteria

- [x] Runbooks cover backup, restore, PITR, and zero-downtime migration.

## Out of scope

- Actually running the drill (ops responsibility).

## Notes / hazards

- Reference `infra/scripts/` helpers from M0.
