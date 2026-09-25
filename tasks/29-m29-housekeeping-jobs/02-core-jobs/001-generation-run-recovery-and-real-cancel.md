---
id: M29.2.1
status: todo
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

- [ ] Integration test:
  - [ ] Insert a `RUNNING` run of this node (simulating a restart) and start the app context: it is `FAILED` with
        `SF-GEN-0504`.
  - [ ] `POST /generations` for that project then answers `202`, not `409`.
- [ ] Stale heartbeat of a foreign node → recovered by the periodic run. A fresh heartbeat → untouched.
- [ ] Cancel a run while it renders (a latch in the pipeline): the status stays `CANCELLED`, `current` is unchanged and
      no manifest is written for it.
- [ ] Race test: cancel concurrently with the final status write, 50 iterations. Never `SUCCESS` after `CANCELLED`,
      and never published after `CANCELLED`.
- [ ] A scheduled generation (M27) waiting for a stuck run proceeds after recovery.
- [ ] `./gradlew build` green.

## Out of scope

- Deleting staged output (`M29.2.2`).
- Multi-node generation execution (§26.2 stays single-node).

## Notes / hazards

- Don't mark a run of **this** node as stale while its thread is alive. Keep an in-memory set of run ids executing
  locally and skip them in the periodic check, whatever the heartbeat says (e.g. a long GC pause).
- Heartbeat updates must not bump the entity's JPA `@Version` (if any) used by other writes; use a targeted `UPDATE`.
- The idempotency map is cleaned by `M29.2.4`. Don't change its semantics here.
