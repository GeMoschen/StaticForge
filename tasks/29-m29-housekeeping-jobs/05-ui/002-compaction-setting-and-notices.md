---
id: M29.5.2
status: todo
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

- [ ] Vitest specs:
  - [ ] card gating by role and archived;
  - [ ] confirm dialog enables Save only with the exact key;
  - [ ] estimate shown;
  - [ ] spine/list/diff/banner render the compacted states from fixtures shaped like the API.
- [ ] Manual check in the running app with a compacted fixture project (seed via the job with a 30-day cutoff on
      back-dated revisions, per the journey setup).
- [ ] `ui` `npm run build` and `npx vitest run` green.

## Out of scope

- Instance-wide compaction policy (the user decided per project).

## Notes / hazards

- Don't let the "older than" input accept values below 30 silently. Show the server rule as a hint and validate
  client-side too.
