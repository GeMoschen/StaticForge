---
id: M29.4.3
status: done
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

- [x] API tests on a compacted fixture (`CompactedHistoryApiTest`):
  - [x] revision list flags;
  - [x] asset read at a compacted revision flagged, and at a non-compacted one not;
  - [x] diff with a mix of compacted and exact assets;
  - [x] restore from a compacted revision;
  - [x] preview header.
- [x] Projects without compaction show `compacted: false` everywhere (no behaviour change; golden JSON of a diff
      unchanged apart from the new fields — `noCompactionNoChange`).
- [x] `./gradlew build` green (server `test --rerun`).

## Out of scope

- UI (`M29.5.2`).

## Notes / hazards

- The flag has to be cheap on hot paths (the page editor loads at the current revision: never compacted). Short-circuit
  when `project.compacted_through` is null or R > `compacted_through`.

### Deviations

- **Fields the UI uses.** `RevisionView.compacted` (list, detail, and the project restore response);
  `ProjectDetail.compactedThrough`; `AssetDetailView.compacted` (`GET /assets/{uuid}/versions/{r}` and
  `POST /assets/{uuid}/restore`, where it means "restored the surviving version"); `RevisionDiff.compacted` +
  `RevisionDiff.message` (`"Exact changes of this revision were compacted; the state at the end of the day is kept"`,
  `null` otherwise) and `AssetDiff.compacted` (then `changes: []` and the summary's `action`).
- **Header instead of body field** on the typed time-travel reads — media, property sets, datasets, records, record
  sets and the record-set grid (`?revision=`) — and on `POST /projects/{key}/restore`: `X-SF-Compacted: true` (absent
  otherwise), like the preview. Their many DTOs stay unchanged; `CompactedReads` (sf-api) adds the header.
- **Diff rule.** An asset is compacted in the diff of `R` when its version at `R` absorbed `R` or its version at
  `R − 1` absorbed `R − 1` (the "before" isn't exact) — e.g. a survivor's own revision. The diff's `compacted` is the
  revision's flag or any asset's; the revision flag itself stays "some removed version started here" (decision 13).
- **Preview header** only for the draft view with `revision` (a published preview renders released versions, which
  compaction never removes), and only the page itself is checked.
- Cheap path: `CompactedHistory` short-circuits on `project.compacted_through` (null or `R` newer → no version query);
  a read without `revision` never queries versions.
