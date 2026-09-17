---
id: M22.2.1
status: done
depends: [M22.1.2, M22.4.1]
epic: m22-build-insight
feature: api
area: backend
---

# M22.2.1 — `POST /generations/plan` (dry run) + `GET /generations/{runId}/plan`

## Context

`server/sf-api/src/main/java/com/acme/staticforge/api/GenerationController.java`
(`/api/v1/projects/{projectKey}/generations`) exposes these endpoints:

- `GET` history (VIEWER)
- `POST` start (DEVELOPER, 202)
- `GET /{runId}`
- `POST /{runId}/cancel`
- `POST /{runId}/promote`
- `GET /{runId}/events` (SSE)

The request body is `api/dto/GenerationRequestDto` (mode, revision, channels, targetId,
folderPath, assetUuids, comment), mapped to `generate.GenerationRequest`.

`GenerationService.start()` enforces one active run per project (`SF-GEN-0500`) and
idempotency. `executeRun()` does snapshot → baseline (`lastRevision`) → `buildPlanner.plan`
inline, so there is no reusable "plan only" method. After `M22.1.2`,
`RunPlanService` reads stored plans.

## Goals

- **Extract a shared planning method** in `GenerationService`, e.g.
  `PlannedBuild planFor(Project, GenerationRequest)`. It returns snapshot revision,
  target, effective channels, baseline and `BuildPlan`. `executeRun` and the dry run
  both call it. After this task no copy of the snapshot/baseline/plan logic remains in
  `executeRun`.
- **Dry run** at `POST /generations/plan`:
  - Role: DEVELOPER (same as start; planning a 5,000-page project is not free).
  - Body: `GenerationRequestDto` unchanged.
  - Query: `page`, `size` (docs/api.md convention), `rootKind`, `channel`,
    `validate=false`.
  - Response `GenerationPlanView`:
    `{revision, mode, incremental, fallbackCause?, baselineRevision?, target:{id,name}, channels[], changedAssets:[{uuid,type,uid,revision}] (capped at 200 + total), summary:{entryCount, byRootKind, byFirstEdge, byChannel}, entries:{content:[PlanEntryView], page:{…}}}`.
  - `PlanEntryView` is `{assetUuid, assetType, uid, displayName, channel, outputPath, reason:{rootKind, rootAsset?, rootRevision?, causeCount, steps:[{assetUuid, assetType, uid, edge, referenceKind?, sourcePath?}]}}`.
  - `validate=true` additionally runs `RenderPipeline.validate(snapshot, plan)` and
    returns its diagnostics. It never renders.
  - Must not create a `GenerationRun`, take the active-run lock, emit SSE, touch the
    idempotency map, persist plan rows, or write `asset_reference`.
  - Works while another run is active.
  - Honors `revision` (plan as of a past revision), `folderPath` and `assetUuids`
    exactly like a real run.
- **Stored plan** at `GET /generations/{runId}/plan` (VIEWER):
  - Same `GenerationPlanView` shape, built from `generation_run.plan_summary` +
    `RunPlanService.entries(...)`.
  - Filters: `rootKind`, `channel`, `q` (uid/displayName/outputPath contains).
  - Returns `planAvailable: false` with summary only when entries were pruned.
  - 404 for a run from another project (reuse `requireRun`).
- **`GenerationRunView`** gains `planSummary` so the history table needs no second call.
- **Tests:**
  - API integration: dry run on an incremental scenario returns expected reasons.
  - **Parity test**: dry run, then a real run with the same request, gives equal
    entries + reasons.
  - Dry run during an active run returns 200, not 409.
  - Dry run creates no rows (`generation_run`, plan tables, `asset_reference` counts
    unchanged).
  - Stored plan paging + filters; pruned plan; cross-project 404; role checks
    (VIEWER can't dry-run, VIEWER can read a stored plan).
- Regenerate OpenAPI and `ui` `schema.d.ts` (`npm run generate:api`).

## Acceptance criteria

- [x] `executeRun` and the dry run share one planning method; no duplicated
      snapshot/baseline/plan code.
- [x] Parity integration test passes.
- [x] Dry run is side-effect free (asserted via row counts) and allowed during an
      active run.
- [x] Stored plan endpoint pages/filters correctly and handles pruned plans.
- [x] Role and cross-project checks covered by tests.
- [x] `docs/api.md` endpoint table updated; OpenAPI + `schema.d.ts` regenerated.
- [x] `./gradlew build` green.

## Out of scope

- Asset impact endpoint (`M22.2.2`).
- UI (`M22.3.*`).
- Caching dry-run results.

## Notes / hazards

- **Parity race:** a save between the dry run and the real run changes the plan. The
  parity test must run both against a fixed state; the UI (`M22.3.1`) shows the dry
  run's `revision` so users can see when it's stale.
- Reuse the per-target, coverage-aware baseline method extracted in `M22.4.1` (a
  prerequisite). Don't reintroduce `runs.findRecentSuccesses(projectId).findFirst()`.
  A dry run over a publish that drops unchanged pages would present a correct-looking
  plan for a broken site.
- `GenerationService` lives in `sf-generate`; `RunPlanService` placement must respect
  the module layering (`checkModuleLayers`). Put the persistence entity/repository in
  `sf-domain` (next to `GenerationRun`) and the reconstruction where the reason records
  live, or move the reason records to `sf-domain`. Decide once and note it in the PR.
- Snapshotting a big project for a dry run is the expensive part. Measure it with the
  benchmark fixture and note the number here. If it exceeds a few seconds, the UI must
  show progress, but don't add async dry-run jobs in this task.
