# Feature: Build insight API

**Spec:** Extends §20.2 (endpoint catalogue — generation and asset endpoints) and §18.1
(request body).

## Goal

Expose the planner's explanations over REST:

- `POST /api/v1/projects/{projectKey}/generations/plan` does a **dry run**. It takes the
  same `GenerationRequestDto` as `POST /generations` and returns the plan summary plus
  the first page of entries with reasons. Nothing is rendered, written, persisted, or
  locked.
- `GET /api/v1/projects/{projectKey}/generations/{runId}/plan` returns the **stored**
  plan of a past run (summary + paged, filterable entries).
- `GET /api/v1/projects/{projectKey}/assets/{uuid}/impact` is **impact**: which entries
  would rebuild if this asset changed, each with its chain.

The dry run and the real run share one code path (snapshot → baseline → plan) so they
can't drift. The impact endpoint uses the same expansion component (`M22.1.1`).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-dry-run-and-run-plan-endpoints.md](001-dry-run-and-run-plan-endpoints.md) | `M22.1.2`, `M22.4.1` |
| 2 | [002-asset-impact-endpoint.md](002-asset-impact-endpoint.md) | `M22.1.1`, `M16.3.3` |

## Feature exit criteria

- [ ] Dry run and a real run started right after with the same request produce equal
      entries + reasons (integration test).
- [ ] Stored plans are readable, paged and filterable; pruned plans answer
      `planAvailable: false`.
- [ ] Impact is computed by the planner's expansion, not by a separate walk.
- [ ] OpenAPI regenerated; `ui/src/app/core/api/generated/schema.d.ts` updated.

## Dependencies

`M22.1.*`, `M4:generation` (`GenerationController`, `GenerationService`,
`GenerationRequestDto`), `M1`/`M6` usages (`AssetController.usages`,
`AssetServiceImpl.usages`).
