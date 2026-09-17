---
id: M22.1.2
status: done
depends: [M22.1.1]
epic: m22-build-insight
feature: planner
area: backend
---

# M22.1.2 — Persist the plan + reasons per generation run

## Context

`GenerationRun` (`server/sf-domain/src/main/java/com/acme/staticforge/generate/GenerationRun.java`,
table `generation_run`, changelog `v1.0/009-generation-run.xml`) stores exactly the
§18.5 fields: counts, status, timings and a grouped `diagnostics` JSON. Nothing about
the plan is stored.

`GenerationService.executeRun` builds the plan (`buildPlanner.plan(...)`, around line
278) and uses it for validate/render/post-process/materialize, then discards it.
After `M22.1.1` the plan carries a `RebuildReason` per entry, and the expansion keeps a
parent-pointer map per visited asset.

## Goals

- **Normalized storage** (new Liquibase changelog; number assigned at implementation
  time; paired PostgreSQL/H2 changesets):
  - `generation_run_plan_node`: `(run_id, asset_uuid, asset_type, uid, parent_asset_uuid NULL, edge_kind, reference_kind NULL, source_path NULL, root_kind NULL, root_revision NULL)`,
    one row per asset visited by the expansion that lies on some stored chain.
  - `generation_run_plan_entry`: `(run_id, asset_uuid, channel, output_path, root_kind, node_asset_uuid NULL, cause_count)`,
    one row per plan entry.
  - FK to `generation_run` with cascade delete, indexes on
    `(run_id, root_kind)`, `(run_id, channel)` and `(run_id, asset_uuid)`.
  - Exact column names and types may be adjusted during implementation. The constraint
    is: chains reconstruct by walking `parent_asset_uuid` inside one run, and nothing is
    stored per entry beyond one row.
- **Run record summary:** add a `plan_summary` JSON column to `generation_run`:
  `{incremental, fallbackCause?, baselineRevision?, changedAssetCount, entryCount, byRootKind:{…}, byFirstEdge:{…}, byChannel:{…}}`.
  The run history table can show it without reading entries.
- **Write path:**
  - `GenerationService.executeRun` persists the plan right after PLAN, before VALIDATE,
    in its own short transaction. A run that fails in VALIDATE/RENDER/WRITE still has an
    explainable plan.
  - Use batch inserts (JDBC batch / `saveAll` with batching enabled). No per-row
    round-trips for 5,000-page projects.
- **Read path** (domain service, working name `RunPlanService`):
  - `summary(runId)`
  - `entries(runId, rootKind?, channel?, assetUuid?, Pageable)`: rebuilds each entry's
    `RebuildReason` from the node table.
  - `reasonFor(runId, assetUuid, channel)`
- **Retention:**
  - Keep plans for the newest *N* runs per project (`sf.generate.plan-retention-runs`,
    default 50).
  - Prune older plan rows after each run completes. Run rows themselves are unaffected.
  - A run whose plan was pruned reports `planAvailable: false`, not an error.
- **Tests:**
  - Integration (H2): a run stores entries + nodes; reconstructed reasons equal
    `BuildPlan` reasons; a FAILED-in-VALIDATE run still has a plan; retention prunes;
    cascade on run delete.
  - Unit: reconstruction of multi-hop chains from node rows.

## Acceptance criteria

- [x] New changelog applies on PostgreSQL and H2 (`ddl-auto: validate` passes in every
      profile).
- [x] A SUCCESS run and a run failing after PLAN both have stored entries whose
      reconstructed reasons equal the in-memory `BuildPlan` reasons (asserted).
- [x] `generation_run.plan_summary` is populated for every run that reached PLAN.
- [x] Storage is normalized: entry rows ≤ entries, node rows ≤ visited assets (asserted
      for a fixture where 100 pages share one chain).
- [x] Retention keeps exactly the configured number of plans per project.
- [x] Persisting the plan for the 5,000-page benchmark fixture takes < 2 s on H2
      (measured and noted in the task).
- [x] `./gradlew build` green.

## Out of scope

- REST endpoints (`M22.2.1`).
- Storing rendered output hashes or per-file timings.
- Export/import of run plans; run history is not part of project archives.

## Notes / hazards

- Earlier epics (`M16`–`M21`) add changelogs before this one lands. Take the next free
  number at implementation time and check the master changelog include order.
- `executeRun` is not `@Transactional` as a whole. Don't wrap the render stages in the
  plan-persist transaction; persist the plan and commit before rendering.
- Tolerate unknown `edge_kind`/`root_kind` names on read (log, map to a generic
  `UNKNOWN` label). Plans written by a newer build must not break an older reader
  after a rollback deploy.
- Deleted assets have no snapshot row. Store `uid`/`asset_type` on the node when
  persisting so old plans stay readable after the asset is gone.
