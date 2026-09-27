---
id: M29.2.1
status: done
depends: [M29.1.1]
epic: m29-housekeeping-jobs
feature: core-jobs
area: backend
---

# M29.2.1 — Interrupted-run recovery and real cancel

## Context

In `GenerationService` (`sf-generate/.../generate/GenerationService.java`):

- `start` (`:162`, `startLock`, `findActive` → `409 SF-GEN-0500`);
- `executeRun` (`:404`; sets `RUNNING` at `:412`, publishes at `:484`, writes the final status at `:488`);
- `cancel` (`:228`, only flips the row);
- `fail` (`:532`), `completeRun` (`:698`, closes SSE emitters);
- the in-memory `idempotencyKeys` and `emittersByRun` (`:114-115`).

Also: `GenerationRun` and `009-generation-run.xml`; the M27 scheduler waits for the active run (M27 decision 27).
Epic decision 9.

## Goals

- **Heartbeat.**
  - `generation_run` gains `executor_node` (varchar 100) and `heartbeat_at`, in a changeset in `024-system-jobs.xml`.
  - `sf.node-id` defaults to `<hostname>-<pid>` and is logged at startup.
  - `executeRun` sets both on `RUNNING` and refreshes `heartbeat_at` at every stage emit, and at least every 30 s
    during long stages (a lightweight update, its own transaction).
- **Real cancel.**
  - `executeRun` checks the run's status (a cheap re-read or an in-memory flag set by `cancel` on this node) between
    stages and inside the render loop, and aborts before `stage`/`publish`.
  - The final status is written with a compare-and-set:
    `UPDATE … SET status=? WHERE id=? AND status='RUNNING'`.
  - A cancelled or recovered run is never overwritten, and a lost compare-and-set skips `publish` if it hasn't happened
    yet. Order the checks so that a run is **never** published after `CANCELLED` was committed.
  - Emitters get a final `CANCELLED` event.
- **Job `generation-run-recovery`** (`runOnStartup = true`, default `*/5 * * * *`, setting `staleAfter` = 5 min):
  - At startup: every `QUEUED`/`RUNNING` run with `executor_node` = this node, or with no node (rows from before
    M29), becomes `FAILED`.
  - Periodically: every `RUNNING` run whose `heartbeat_at` is older than `staleAfter`, and every `QUEUED` run older than
    `staleAfter` that no executor holds, becomes `FAILED`, on any node.
  - `FAILED` here means: diagnostic `SF-GEN-0504` "Run interrupted (node restart or lost heartbeat)", `finishedAt`,
    emitters completed if local.
  - The staged output is left for `M29.2.2`.
- The job's run report lists the recovered run ids per project.

## Acceptance criteria

- [x] Integration test:
  - [x] Insert a `RUNNING` run of this node (simulating a restart) and start the app context: it is `FAILED` with
        `SF-GEN-0504`.
  - [x] `POST /generations` for that project then answers `202`, not `409`.
- [x] Stale heartbeat of a foreign node → recovered by the periodic run. A fresh heartbeat → untouched.
- [x] Cancel a run while it renders (a latch in the pipeline): the status stays `CANCELLED`, `current` is unchanged and
      no manifest is written for it.
- [x] Race test: cancel concurrently with the final status write, 50 iterations. Never `SUCCESS` after `CANCELLED`,
      and never published after `CANCELLED`.
- [x] A scheduled generation (M27) waiting for a stuck run proceeds after recovery.
- [x] `./gradlew build` green.

## Out of scope

- Deleting staged output (`M29.2.2`).
- Multi-node generation execution (§26.2 stays single-node).

## Notes / hazards

- Don't mark a run of **this** node as stale while its thread is alive. Keep an in-memory set of run ids executing
  locally and skip them in the periodic check, whatever the heartbeat says (e.g. a long GC pause).
- Heartbeat updates must not bump the entity's JPA `@Version` (if any) used by other writes; use a targeted `UPDATE`.
- The idempotency map is cleaned by `M29.2.4`. Don't change its semantics here.

### Deviations

- **Changeset `026-generation-run-heartbeat`** in `026-system-jobs.xml` (not `024`, see M29.1.1): `executor_node`
  (varchar 100), `heartbeat_at`, and an index on `generation_run.status` for the recovery scan.
- **`sf.node-id`** is the bean `NodeIdentity` (`sf-domain`, `com.acme.staticforge.node`), default `<hostname>-<pid>`,
  logged at startup. The scheduler and the system-job runner take `SchedulerProperties.effectiveNodeId(NodeIdentity)`:
  `sf.scheduler.node-id` still overrides for them, otherwise all three use `sf.node-id` (the no-arg
  `effectiveNodeId()` is gone). `SF_NODE_ID` sets it in `application.yml`.
- **`executor_node` is set when the run is queued**, not only on `RUNNING`; `heartbeat_at` on `RUNNING`. A run is
  *held* by this node's executor (`GenerationRunControl`) from before its row commits until its final write.
- **One rule set for startup and periodic runs.** A run not held here is interrupted when it has no node, its node is
  this node, its node is a dead earlier process of this host (`NodeIdentity.isDeadLocalProcess`: default ids change
  with every restart, so without a stable `sf.node-id` the restarted node recognizes its old runs by their dead pid),
  or its heartbeat (a queued run's queue time) is older than `staleAfter` (setting, min 1 min). The decision is
  re-checked on the locked row (`GenerationService.interrupt`).
- **Compare-and-set** is a row lock (`EntityManager.refresh(..., PESSIMISTIC_WRITE)`, i.e. `SELECT … FOR UPDATE`) plus
  the state check and the write in one transaction (`GenerationRunControl.whileRunning/whileActive`). The executor's
  final write **publishes inside that lock** (manifest, flip, status), so whichever of cancel and final write commits
  first wins and the other sees it: never `SUCCESS` or published after `CANCELLED`. `QUEUED → RUNNING` is a
  conditional `UPDATE` (`markRunning`); every executor write goes through these helpers, never an entity merge.
- **Stop checks**: `stage()` (probe, heartbeat — which doubles as the status re-read — and the in-memory flag) at each
  stage and before publishing; `checkpoint()` per page in the render loop (`RenderPipeline.execute(..., RunCheckpoint)`
  checks before each page renders and before collecting each result; a `RunAbortedException` cancels pending pages).
  The in-memory flag is set by a cancel after it commits, or by a heartbeat that finds the run no longer `RUNNING`.
- **Heartbeat interval** is `sf.generate.heartbeat-interval` (default 15 s), plus one beat per stage.
- **Latch seam**: `GenerationRunProbe` beans are called at each stage, per page (`RENDER_PAGE`) and before the final
  write (`PUBLISH`); production has none, tests use `RunLatches` (test sources).
- `SF-GEN-0504` runs get `errorCount = 1`; emitters get a final `REPORT` event with the terminal status
  (`CANCELLED`/`FAILED`) and are completed. The executor of a stopped run writes nothing and publishes nothing.
- Tests: `GenerationRunStartupRecoveryTest` (own context with `sf.housekeeping.enabled=true`, rows written by an
  application-ready listener ordered before the job starter), `GenerationRunRecoveryIntegrationTest` (stale/fresh,
  held run with an hour-old heartbeat untouched and heartbeat refresh during a long stage, cancel while rendering with
  SSE check, 50-iteration race in three interleavings — a mutant without the status check fails it — and the waiting
  schedule).
