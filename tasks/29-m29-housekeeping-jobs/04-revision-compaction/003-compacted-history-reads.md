---
id: M29.4.3
status: todo
depends: [M29.4.2]
epic: m29-housekeeping-jobs
feature: revision-compaction
area: backend
---

# M29.4.3 — Compacted history in time travel, diff and restore

## Context

- `DiffService`/`DiffServiceImpl` (`GET /revisions/{r}/diff`, touched assets vs `r-1`).
- The revision list and spine endpoints (`RevisionController` or the equivalent in `sf-api`).
- Point-in-time reads (`AssetService.findAt`, `?revision=` on asset endpoints, preview with `revision`).
- `POST /assets/{uuid}/restore?fromRevision=R` and `ProjectRestoreService.restoreTo`.
- Epic decision 13 ("Reads").

## Goals

- **Revision views** (list, detail, spine) carry `compacted` (boolean). The project view carries `compactedThrough`.
- **Point-in-time reads.** A read of an asset at R carries `compacted: true` when the version valid at R has
  `original_valid_from` set and R < `original_valid_from`. That means R lies in an interval the version absorbed, so
  the state shown is later than the exact state at R. Preview at a revision passes the flag as the `X-SF-Compacted: true`
  header when any rendered asset is compacted at R (the page itself is enough for the header; document that).
- **Diff** of a compacted revision: the assets of the summary whose change was absorbed are returned with
  `compacted: true` and no field changes, plus the message "Exact changes of this revision were compacted; the state
  at the end of the day is kept". Assets touched in R whose version survived are diffed normally.
- **Restore** from a compacted revision restores the surviving version. The response carries `compacted: true` so the
  UI can say what it restored.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] API tests on a compacted fixture:
  - [ ] revision list flags;
  - [ ] asset read at a compacted revision flagged, and at a non-compacted one not;
  - [ ] diff with a mix of compacted and exact assets;
  - [ ] restore from a compacted revision;
  - [ ] preview header.
- [ ] Projects without compaction show `compacted: false` everywhere (no behaviour change; golden JSON of an existing
      diff test unchanged apart from the new field).
- [ ] `./gradlew build` green.

## Out of scope

- UI (`M29.5.2`).

## Notes / hazards

- The flag has to be cheap on hot paths (the page editor loads at the current revision: never compacted). Short-circuit
  when `project.compacted_through` is null or R > `compacted_through`.
