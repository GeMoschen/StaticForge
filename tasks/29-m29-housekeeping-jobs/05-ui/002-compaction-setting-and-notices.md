---
id: M29.5.2
status: done
depends: [M29.4.1, M29.4.3]
epic: m29-housekeeping-jobs
feature: ui
area: frontend
---

# M29.5.2 — Compaction setting and compacted-history notices

## Context

- Project settings shell (`features/settings/project-settings-*`, General view).
- `ProjectAccessStore.readOnly` (archived or time travel) and `AuthStore.roleFor` (`PROJECT_ADMIN` gating).
- `features/revisions/`: `revision-spine.component.*`, `revisions-list.component.*`, `revision-diff.component.*`,
  `time-travel.store.ts`.
- The M26 delete-user dialog (type-to-confirm pattern).
- Epic decision 13.

## Goals

- **Compaction card** in project settings (General, below the description; visible to every member, editable only by
  `PROJECT_ADMIN` and read-only when archived):
  - explanation text in plain words: what is kept (releases, retained builds, scheduled pins, the end of each day) and
    what is lost (exact intermediate states older than N days);
  - `older than` (days, minimum 30).
  - **Enable** opens a dialog with the estimate (`GET …/compaction/estimate`: versions removed, bytes) and a
    type-the-project-key confirmation, and saves with `?confirm=`.
  - Disable needs one click and no typing.
  - Shows `compactedThrough` and the last compaction result.
- **Notices.**
  - The revision spine and list mark compacted revisions (an icon and a tooltip "Exact changes compacted — end-of-day
    state kept").
  - The time-travel banner adds "Compacted history: you see the state at the end of that day" when the read carries
    `compacted`.
  - The diff view shows the per-asset compacted message instead of an empty diff.
  - Restore from a compacted revision says in its confirmation that the end-of-day state will be restored.

## Acceptance criteria

- [x] Vitest specs:
  - [x] card gating by role and archived;
  - [x] confirm dialog enables Save only with the exact key;
  - [x] estimate shown;
  - [x] spine/list/diff/banner render the compacted states from fixtures shaped like the API.
- [ ] Manual check in the running app with a compacted fixture project (seed via the job with a 30-day cutoff on
      back-dated revisions, per the journey setup).
- [x] `ui` `npm run build` and `npx vitest run` green (`npx ng build`; vitest 104 files / 707 tests).

## Out of scope

- Instance-wide compaction policy (the user decided per project).

## Notes / hazards

- Don't let the "older than" input accept values below 30 silently. Show the server rule as a hint and validate
  client-side too.

### Deviations

- **Manual run-app check not done here** (left to the coordinator, as agreed): it needs a compacted fixture project.
- **Members see only part of the card.** `GET /projects/{key}/compaction` is `PROJECT_ADMIN` on the server, so every
  member sees the explanation and "Compacted through" (from `ProjectDetail.compactedThrough`) plus "Only project admins
  can see and change this setting."; project admins also see status, age, last run and the controls.
- **Archived admins still read the policy.** The UI lowers the effective role to `VIEWER` in an archived project, but
  the server authorizes reads by membership. New `AuthStore.memberRoleFor` (the un-lowered role; `roleFor` now uses it)
  and `ProjectPermissionsStore.readsAsProjectAdmin` let the card load the policy there, read-only
  (`canAdminProject` gates editing, so time travel is read-only too). `provideProjectPermissions` got a `memberRole`
  option.
- **Age changes while enabled.** Raising `olderThanDays` saves at once; lowering opens the same estimate + type-the-key
  dialog (the server needs `confirm` then too). While disabled the age is only the value Enable uses. The client
  refuses anything but a whole number ≥ 30 (inline message, Enable/Save disabled) and shows the rule as the field hint.
- **How the banner learns `compacted`.** The notice shows when the travelled-to revision has `RevisionView.compacted`
  (the shell's loaded revision list) **or** a read at that revision came back compacted. The revision flag alone misses
  revisions whose own changes were kept but whose assets show a later same-day state, so a new
  `compactedReadInterceptor` (registered last in `app.config.ts`) looks at `GET`s with `?revision=` (header
  `X-SF-Compacted: true`) and `GET …/assets/{uuid}/versions/{r}` (`AssetDetailView.compacted`) and reports the revision
  to `TimeTravelStore.noteCompactedRead`; `readCompacted` compares with the active revision, `exit()` clears. The banner
  moved from the shell into `TimeTravelBannerComponent` (`features/revisions/`) to be testable; it keeps the
  `shell__timemachine*` classes the e2e journeys select.
- **Diff and restore.** The diff shows `RevisionDiff.message` at the top when `compacted`, and the same message in
  place of the field diff for each `AssetDiff.compacted` asset. The roll-back confirmation adds "the state at the end of
  its day will be restored" when `RevisionDiff.compacted`. "Restore this asset" on an asset with `AssetDiff.compacted`
  first opens a confirmation ("… the state at the end of that day will be restored", confirm → restore); exact assets
  keep the one-click restore. `AssetDiff.compacted` is the per-asset signal: the diff lists only assets changed at the
  revision, and such an asset's state there is inexact exactly when its change was absorbed (the interceptor's state is
  per revision, too coarse for one asset). The success toast also says the end-of-day state was restored when the
  response's `AssetDetailView.compacted` is true.
- Notice wording lives in `features/revisions/compaction.util.ts`; the marks use the `compress` Material symbol.
