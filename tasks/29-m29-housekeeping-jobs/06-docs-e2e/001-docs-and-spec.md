---
id: M29.6.1
status: done
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

- [x] Every item above is updated. Links resolve (relative links and anchors of the six touched files checked by a
      script; the only misses are the spec's pre-existing OCTL/Markdown examples like `$CMS_REF(heroImage)`). The
      spec's error catalogue matches the code for every M29 code: `SF-DOM-0180`–`0184` (`HousekeepingProblems`) and
      `SF-GEN-0500`–`0505` (`GenerationService`, `GenerationController`; `0501`–`0503` were missing and are added too).
- [x] `./gradlew build` green (spec-driven doc tests, if any): there are none (no test reads the spec or `docs/`), and
      this task changes only Markdown, so it can't affect the build. Gradle was not run for this task (coordinator
      instruction: other streams were editing Java in the same tree).

## Out of scope

- `tasks/README.md` (the coordinator updates the epic map).

## Notes / hazards

- Keep the §7.7 text normative (what the system guarantees), and keep the algorithm detail in the task files and code
  Javadoc.

### What changed

- **`cms-specification.md`:** §7.2 (`revision.compacted`), §7.4 (`original_valid_from`, compaction as the one
  exception to "nothing is removed"), §7.7 rewritten (policy and API, job, window, UTC days, protected versions,
  absorb into the next survivor, guarantees, reads/diff/restore, `X-SF-Compacted`); §8.1 (`compaction_policy`,
  `compacted_through`, estimate allowed on archived projects); §11.2 (write path and lock, delete order, orphan
  claims, dry run, `lastSweep`, restore-drill pointer, S3 stub; the stream's mark-and-sweep paragraph kept); §11.4
  (implemented instance-wide policy, `media_variant`, resolver, backfill); §18.4 (published-only `keep-builds`,
  promote refusal `SF-GEN-0505`, `build-output-cleanup`); §18.5 (`executor_node`, `heartbeat_at`, idempotency TTL,
  recovery `SF-GEN-0504`, real cancel, run retention); §20.2 (compaction and `/admin/jobs/**` rows, cancel/promote
  notes, compacted read fields); §21.4, §21.5 (cache key uses the version's own revision); §23 config sample
  (`sf.node-id`, `sf.housekeeping`, `sf.revision` removed); §24.2 spine notices, §24 screen 11 *Jobs*; §26.2–§26.6;
  Appendix B (`SF-DOM-0180`–`0184`, `SF-GEN-0501`–`0505`); Appendix C Q4 resolved.
- **`docs/administration.md`:** roles table, "Housekeeping jobs (M29)" runbook (jobs table with what each deletes and
  never touches, defaults vs. saved settings, changing a job, dry run first, outcomes and failures, monitoring,
  interrupted builds, backups and restore drills), audit trail (new actions, retention enforced).
- **`docs/api.md`:** §3.4 revision compaction, §10 cancel/recovery/promote/retention, §11 compacted history, §14.2
  system jobs (shapes, rules, job/settings table), §15 codes.
- **`docs/user-guide.md`:** compacted history in time travel, the compaction card, promote/cancel/interrupted builds,
  a link from "Compaction and exports".
- **`infra/README.md`:** `SF_NODE_ID`, `sf.node-id`, `sf.scheduler.node-id` default corrected, `sf.generate.keep-builds`,
  `heartbeat-interval`, `idempotency-ttl`, a "Housekeeping jobs (M29)" section with every `sf.housekeeping.*` key and
  the removal of `sf.revision.retention-days`.
- Not touched: `infra/docs/backup-recovery-runbook.md` already got its sweep note from the blob-sweep stream (outside
  this task's file set); the spec and the admin guide link to it.

### Deviations (plan vs. built, as documented)

- Changelogs `026-system-jobs.xml` / `027-revision-compaction.xml` (not `024`/`025`); per-job property classes
  `sf.housekeeping.<key>.*`; `sf.housekeeping.enabled` gates scheduled/startup runs per node.
- `sf.node-id` is `NodeIdentity` (default `<hostname>-<pid>`); `sf.scheduler.node-id` still overrides it for leases. A
  restarted node also recognizes its old runs by their dead pid. `executor_node` is set at queue time. Heartbeat every
  `sf.generate.heartbeat-interval` (15 s), not "every 30 s".
- Promote refusal is `409 SF-GEN-0505` (also for a build no longer on disk). "Published" = manifest / finished zip /
  S3 key manifest; pre-M22 builds are no longer counted or pruned. S3 targets and S3 blob-store listing are stubs.
- Blob sweep uses `blob.last_referenced_at` and a row lock in the shared blob write path; `ref_count` also counts
  `media_variant` and run references.
- Variants: no `appliesTo`; generation reads derived variants through `SnapshotService`; a backfilled variant doesn't
  trigger an incremental rebuild.
- `refresh-token-cleanup` and `media-variant-backfill`/`search-maintenance` have no dry run (only the five of epic
  decision 4). Settings are camelCase in the API; durations serialize as ISO-8601 (`reuseWindow` default `PT168H`).
- Compaction: omitted `olderThanDays` keeps the current value (90 initially); `0183` is checked before `0182`; running
  builds' revisions are protected too; typed time-travel reads and project restore signal `X-SF-Compacted` instead of a
  body field; the diff rule also flags an asset whose "before" (R − 1) was absorbed.
- Run retention: no FK to decide; deleted runs leave `detail.deletedGenerationRunId` on schedule executions; base runs
  come from `planSummary.baseRunId`.
- The Jobs page has no client-side "next 3 runs" (the cron is described in words, `nextRunAt` shown after save).

### Open points for the coordinator

- The compaction card and notices (`M29.5.2`) were not built when this was written: the user guide and spec §24.2
  describe them from that task's goals (Settings → General, typed key + estimate, spine/list icon and tooltip, banner
  text, diff message, restore confirmation). Reconcile wording if the UI differs.
- Appendix B still lacks many pre-M29 codes that the code raises (e.g. `SF-DOM-0103`, `0104`, `0121`, `0140`,
  `SF-GEN-0111`, `0230`, `0240`, `0241`, `SF-MEDIA-05xx`, `SF-EXP-0500`, `SF-CH-*`); most are listed in `docs/api.md`
  §15 as implemented additions. Out of M29's scope.
