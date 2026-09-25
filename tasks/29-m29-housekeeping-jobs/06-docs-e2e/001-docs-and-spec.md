---
id: M29.6.1
status: todo
depends: [M29.1.2, M29.2.1, M29.2.2, M29.2.3, M29.2.4, M29.3.1, M29.3.2, M29.3.3, M29.4.3, M29.5.1, M29.5.2]
epic: m29-housekeeping-jobs
feature: docs-e2e
area: qa
---

# M29.6.1 — Docs and spec

## Context

- `cms-specification.md` §7.7, §11.2, §11.4, §18.4, §18.5, §20.2, §26.2–§26.6, Appendix B.
- `docs/administration.md` (M26), `docs/api.md` (§14 admin), `docs/user-guide.md`, `infra/README.md`
  (`sf.*` properties).
- The epic's "Spec follow-up" note.

## Goals

- **Spec.**
  - §7.7: the implemented compaction model (opt-in per project, ≥ 30 days, UTC days, protected versions, absorb into
    the next survivor, `revision.compacted`, `original_valid_from`, reads, diff, restore). Remove "specified here only
    to reserve the design space".
  - §11.2: mark-and-sweep, grace period, orphan objects, `ref_count` derived; the sweep/restore-drill caveat.
  - §11.4: `media_variant` derived variants, backfill; the policy is still instance-wide (note the deviation from "per
    project").
  - §18.4: `keep-builds` counts published builds; promote refuses unpublished runs; build-output cleanup.
  - §18.5: `executor_node`, `heartbeat_at`, interrupted runs `SF-GEN-0504`, real cancel, run retention.
  - §20.2: `/admin/jobs/**`, `/projects/{key}/compaction`, `/compaction/estimate`.
  - §26.3: audit retention enforced (365 days default, configurable, minimum 30); new audit actions.
  - §26.4: `sf.job.*` metrics and the "housekeeping stale" alert (`sf.job.last.success.age` > 2× the schedule
    interval).
  - §26.5: sweep and compaction vs. backups.
  - §26.6: the Jobs page.
  - Appendix B: `SF-DOM-0180`–`0184`, `SF-GEN-0504`, and the promote refusal code chosen in `M29.2.2`.
- **`docs/administration.md`.** A "Housekeeping jobs" runbook:
  - each job, what it deletes and what it never deletes;
  - defaults and settings, dry run first, reading reports;
  - what to do when a job fails;
  - interrupted builds;
  - the restore-drill caveat (disable `blob-sweep` or keep blob snapshots older than grace + backup interval).
- **`docs/api.md`.** The new endpoints.
- **`infra/README.md`.** `sf.housekeeping.*`, `sf.node-id`, `sf.generate.idempotency-ttl`; removal of
  `sf.revision.retention-days`.
- **`docs/user-guide.md`.** The compacted-history notice in time travel, and the compaction card for project admins.
- Record deviations between plan and code in this task's notes.

## Acceptance criteria

- [ ] Every item above is updated. Links resolve. The spec's error catalogue matches the code (grep the codes).
- [ ] `./gradlew build` green (spec-driven doc tests, if any).

## Out of scope

- `tasks/README.md` (the coordinator updates the epic map).

## Notes / hazards

- Keep the §7.7 text normative (what the system guarantees), and keep the algorithm detail in the task files and code
  Javadoc.
