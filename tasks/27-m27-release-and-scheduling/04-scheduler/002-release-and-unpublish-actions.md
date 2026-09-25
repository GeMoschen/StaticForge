---
id: M27.4.2
status: done
depends: [M27.4.1]
epic: m27-release-and-scheduling
feature: scheduler
area: backend
---

# M27.4.2 — `RELEASE` and `UNPUBLISH` actions: pin policy, re-pin, then-generate

## Context

`M27.4.1` (engine, SPI, executions), `M27.1.2` (`ReleaseService.release/unpublish/plan`, completeness gate), 
`GenerationService.start` / `GenerationRequest` (incremental mode, target, channels). Epic decisions 7, 9, 10, 21, 22, 25, 27.

## Goals

- **`RELEASE` handler.** Params `{items:[{assetUuid, locale, pinnedVersionId?}], includeDependencies:[…], comment}`
  and `pinPolicy` `PINNED` (default) | `LATEST`.
  - At creation (`validate`): items resolved via `ReleaseService.plan`; with `PINNED` each item stores the open version
    id at creation time; dependency choices are stored as items too (so what executes is exactly what the user saw).
  - At execution: `PINNED` releases the stored versions; `LATEST` releases the open version of each item at that
    moment. Items that can't be released (asset gone, `ERROR` findings for `LATEST`, locale removed) are skipped
    individually; the execution outcome is `PARTIAL` with `detail.items[{uuid, locale, result, reason}]`. All
    releasable items go in **one** release revision (`ChangeType.RELEASE`, comment "Scheduled release #id: …").
  - A pinned item whose asset got a newer draft since pinning keeps releasing the pinned version (decision 22).
- **`UNPUBLISH` handler.** Params `{items:[{assetUuid, locale}], comment}`; executes `ReleaseService.unpublish` in one
  revision; items already unreleased are no-ops.
- **Then generate.** `then_generate` `{targetId?, channels?}` → after a successful/partial release revision, start an
  incremental generation (`GenerationService.start` with `revision` = the release revision, mode `INCREMENTAL`,
  comment "After scheduled release #id") as the owner. If a run is active, the step waits (decision 27): the execution
  stays open with message "waiting for run #n" and the engine retries the generate step on later ticks — the release
  part is not repeated (store progress in the execution `detail`).
- **Drift info.** `ScheduleDrift.forAction(action)` → per pinned item: `draftChangedSinceScheduled` (open version ≠
  pinned) and `pinnedStatus`; used by the API (`M27.4.4`) and the Changes view.
- **Re-pin.** `ReleaseScheduleService.repin(actionId, actor)` sets every pinned item to the current open version
  (re-running completeness validation), one `updated_at` bump, audit `SCHEDULE_UPDATED`.

## Acceptance criteria

- [x] Pinned: schedule at T, edit the page before T, execute → the pinned version is released; the newer draft stays
      `CHANGED`.
- [x] Latest: the newer draft is released; with `ERROR` findings in it that item is skipped, the rest released,
      outcome `PARTIAL` with per-item reasons.
- [x] One revision per execution regardless of item count; re-executing after a lease expiry releases nothing twice.
- [x] Then-generate starts an incremental run at the release revision; with a run active it waits and starts once the
      run ends; a retry doesn't re-release.
- [x] Unpublish at T removes the outputs on the then-generate run.
- [x] Re-pin updates pinned versions and clears drift.
- [x] `./gradlew build` green.

## Out of scope

- REST (`M27.4.4`), UI (`M27.6.2`, `M27.6.5`).

## Notes / hazards

- The permission requirement is `ReleasePermissions.canRelease/canUnpublish` of the owner (same component as the
  REST path, `M27.1.3`), plus generation start permission if `then_generate` is set — so `M28` changes both in one
  place.

## Implementation notes

- `scheduler/actions`: `ReleaseActionHandler`, `UnpublishActionHandler` over a shared `ReleaseStateActionHandler`;
  `ScheduleDrift` (bulk per project). "Then generate" goes through the port `ScheduledGenerationStarter` (declared in
  `sf-domain/scheduler`, implemented by `sf-generate`'s `ScheduledGenerations`), because `sf-domain` may not depend
  on generation.
- **Stored params** carry `resolved: true` and one item per locale key (`{assetUuid, locale, pinnedVersionId?,
  deletion?}`); request params (`items` + `includeDependencies`) are resolved through `ReleaseService.plan`. An edit
  that resends stored params keeps the pins while the policy stays `PINNED` (they are re-checked); switching to
  `PINNED` pins the current drafts. A pinned version with `ERROR` findings is refused at scheduling (`422 0150`).
  An item scheduled while its draft was deleted is stored as `deletion` (releasing it takes the asset offline).
- **Execution.** Items are probed with `ReleaseService.plan` *outside* the release transaction (a refusal thrown inside
  a joined `@Transactional` would mark that transaction rollback-only): one plan call, and per-item plans only when it
  fails with `0151`/`0154`. Skipped with a reason: asset/locale gone, pinned item deleted (or deletion restored) since
  scheduling, `LATEST` item incomplete. The rest is released in one revision (`ChangeType.RELEASE`, comment
  "Scheduled release #id: …", truncated to the column's 500 characters) together with the checkpoint
  `{items[], revision}`. Outcome: `SUCCEEDED` (all applied or already live), `PARTIAL`, or `FAILED` (all skipped).
- **Then generate** after a revision: `INCREMENTAL` at the release revision, target/channels as stored, as the owner,
  idempotency key `schedule-{id}-{scheduledFor}-then`. Busy → `WAITING` ("… Waiting for run #n.", abandon outcome
  `PARTIAL`); past a `SKIP_IF_LATER_THAN` bound → `PARTIAL` with `detail.generation.result = SKIPPED`; refused →
  `PARTIAL` with the reason.
- **Re-pin** is the SPI's `repin(spec, actor)` behind `ScheduleService.repin` (instead of a `ReleaseScheduleService`):
  the controller stays type-agnostic. `pinnedStatus` of the drift became the item's current release `status`, next
  to `draftChangedSinceScheduled`.
- Tests: `ScheduledActionsIntegrationTest` (pinned, latest/partial, one revision + crash re-run + unchanged,
  then-generate with a busy project + unpublish removes the output, re-pin clears drift).
