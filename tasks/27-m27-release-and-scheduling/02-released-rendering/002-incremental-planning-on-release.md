---
id: M27.2.2
status: done
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

- [x] Save a draft of a published page → incremental dry run plans nothing (for that page).
- [x] Release it (EN only) → plans exactly the EN outputs of that page plus pages whose released versions reference it,
      with root `ASSET_RELEASED`; DE unchanged.
- [x] Unpublish a page → its outputs are removed, linking pages are rebuilt (their links now render empty with
      `SF-GEN-0221`), navigation containers rebuilt.
- [x] The first incremental build after the migration plans nothing on an unchanged project.
- [x] Media released (new file) → pages using it rebuilt and the file copied; media draft replaced → nothing planned.
- [x] Reason chains stored and shown via `GET /generations/{id}/plan` with the new root kinds.
- [x] `./gradlew build` green.

## Out of scope

- Scheduling builds after releases (`M27.4.2`), UI changes beyond tolerating the new root kinds (the plan table shows
  unknown roots generically; label strings in `M27.6.x` if needed).

## Notes / hazards

- `findChangesBetween` becomes two sources (version changes of live types + pointer changes of releasable types);
  keep them in one method so every caller (dry run, real run, impact endpoint) gets the same answer.
- `AssetImpactController` (`/assets/{uuid}/impact`) answers "what would rebuild if this asset changed": for releasable
  assets it should now answer "if this draft were released" — adjust and test.
- Watch the M22 invariant tests (deterministic BFS order, first-edge wins); extend them with release seeds.

## Implementation notes

- **One walk per language.** `RebuildExpansion.expandSince` walks each language view with that language's changes; an
  output is planned when its language's walk reaches its page (`Walks`). This replaces M24's translation-diff
  narrowing (`LocaleValueDiff`, removed): a change confined to one language moves only that language's pointer, and a
  reason whose page was rebuilt in fewer languages than it has records them (`changedLocales`).
- **Seeds** (`Delta`): live types by versions and uid history in `(B, R]`; releasable assets by comparing the pointer
  (version, uid) for the language — own key, else `""` — between the release state at B and at R. Root kinds
  `ASSET_RELEASED` (opened/moved), `ASSET_UNPUBLISHED` (closed, draft kept), `ASSET_DELETED` (a released deletion);
  the root revision is the release revision. The "before" version of a releasable root is its released version at B.
- **Migration seeds nothing.** A baseline with no release state at all rendered the drafts valid then (a pre-M27 build,
  or a build that rendered nothing), so a pointer at the version that was the draft at B, under an unchanged uid, is
  no change. Keyed on "state at B empty" rather than on the migration revision, so it needs no marker.
- **Edges.** The walk's rows are the edges valid at R plus the edges of released versions that are no longer their
  asset's draft (`AssetReleaseRepository.findReleasedEdgeRowsValidAt`, one query): a released page is reached over
  what it references even when its draft dropped the reference. Over-approximating with draft edges is harmless.
- **Impact** answers "if this draft were released": the released snapshot with the asset at its draft in every
  language (`SnapshotService.snapshot(…, asDrafts)`), so a NEW page's impact includes its own outputs.
- **Insight.** Plan entries carry their `locale` (stored: changeset `020-release-state-plan-entry-locale`, a nullable
  `generation_run_plan_entry.locale`; served on `PlanEntryView`). The UI reads the new kinds as "Released" /
  "Unpublished" and the chain text as `en/about.html ← media:hero · released in r1902, en`.
- **Tests:** `ReleaseIncrementalPlanIntegrationTest` (6: a draft plans nothing, a release plans the page and its
  referrers rooted at the release revision and stores the kind, unpublish removes the output and rebuilds links and
  navigation with `SF-GEN-0221`, one-language release, media draft vs release, initial release plans nothing, impact
  of a NEW page); the M22/M25 plan tests now release their edits and expect `ASSET_RELEASED` for editorial roots.
