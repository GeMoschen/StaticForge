---
id: M27.2.2
status: todo
depends: [M27.2.1, M27.1.2]
epic: m27-release-and-scheduling
feature: released-rendering
area: backend
---

# M27.2.2 — Incremental planning seeded by release changes

## Context

`sf-generate/.../generate/plan/RebuildExpansion.java` (`changesSince` `:144`, `expand` `:175`), `BuildPlanner`,
`GenerationService` (`planFor` `:277`, `baselineFor` `:380`), `AssetVersionRepository.findChangesBetween` (`:360`),
uid history, `BuildManifest` (`consistentRevision`), reason-chain roots (`ASSET_CHANGED`, `ASSET_DELETED`, …),
`GenerationRunPlan*` storage, `PlanViews` (API) and the plan UI (`features/generation/insight/`). Epic decisions 3, 5, 7,
16.

## Goals

- **Seeds.** In the released view, "asset X changed in locale L between baseline B and R" means its **released
  version for L** differs between B and R (pointer opened/closed/moved in `(B, R]`), for releasable types; live types
  keep counting version changes. Saving a draft seeds nothing.
- **Per-locale seeds.** A change of the EN pointer seeds EN outputs only (M24's per-locale planning); the walk over
  reverse `asset_reference` edges uses edges of the **released** versions (edges valid at the version's revision), so a
  page referencing a media is reached when the media's released version changes, not when its draft does.
- **Root kinds.** New reason-chain roots `ASSET_RELEASED` (pointer moved/opened) and `ASSET_UNPUBLISHED` (pointer
  closed); `ASSET_CHANGED` remains for live types. Names served as strings (clients tolerate new names, §18.2).
- **Navigation rule.** A navigation-affecting change (§18.2 walk rules) is evaluated on released versions: releasing a
  page's rename or move affects navigation; its draft doesn't.
- **Output moved.** A released move/rename changes the output path → the existing "output path moved" rule applies
  (pages linking it are reached). The old output is removed by carry-forward as today.
- **Baseline fallbacks** unchanged (`NO_COMPLETE_BUILD_FOR_TARGET`, …). The migration revision itself (M27.1.1) seeds
  nothing when versions are unchanged (pointers opened at the versions already built): special-case "pointer opened at
  the version that was valid at B" as no change.
- **Dry run / insight** shows the new roots with the released revision and locale in the chain text, e.g.
  `page:about ← media:hero (released in r1902, en)`.

## Acceptance criteria

- [ ] Save a draft of a published page → incremental dry run plans nothing (for that page).
- [ ] Release it (EN only) → plans exactly the EN outputs of that page plus pages whose released versions reference it,
      with root `ASSET_RELEASED`; DE unchanged.
- [ ] Unpublish a page → its outputs are removed, linking pages are rebuilt (their links now render empty with
      `SF-GEN-0221`), navigation containers rebuilt.
- [ ] The first incremental build after the migration plans nothing on an unchanged project.
- [ ] Media released (new file) → pages using it rebuilt and the file copied; media draft replaced → nothing planned.
- [ ] Reason chains stored and shown via `GET /generations/{id}/plan` with the new root kinds.
- [ ] `./gradlew build` green.

## Out of scope

- Scheduling builds after releases (`M27.4.2`), UI changes beyond tolerating the new root kinds (the plan table shows
  unknown roots generically; label strings in `M27.6.x` if needed).

## Notes / hazards

- `findChangesBetween` becomes two sources (version changes of live types + pointer changes of releasable types);
  keep them in one method so every caller (dry run, real run, impact endpoint) gets the same answer.
- `AssetImpactController` (`/assets/{uuid}/impact`) answers "what would rebuild if this asset changed": for releasable
  assets it should now answer "if this draft were released" — adjust and test.
- Watch the M22 invariant tests (deterministic BFS order, first-edge wins); extend them with release seeds.
