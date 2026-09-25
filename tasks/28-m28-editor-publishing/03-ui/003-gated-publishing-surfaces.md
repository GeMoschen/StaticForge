---
id: M28.3.3
status: todo
depends: [M28.3.1, M28.2.1, M28.2.2]
epic: m28-editor-publishing
feature: ui
area: frontend
---

# M28.3.3 — Permission-gated publishing surfaces

## Context

`features/generation/generation.component.*` ("New generation", Cancel, Promote — shown to everyone today),
`generation-dialog.component.ts` (mode, target, comment, channels; no scope), `ProjectSettingsTargetsComponent`
(create/edit/delete targets), M27 UI: release bar in the asset editors, the project **Changes** view (Release /
Discard / Schedule), the schedules list and dialogs. `ProjectPermissionsStore` (`M28.3.1`), `GenerationRunView.comment`
/ `startedBy` (`M28.2.2`). Epic decisions 7–9, 11, 14.

## Goals

- **Generation screen.**
  - "New generation" only with `canIncrementalBuild`. For an editor without `canFullBuild` the dialog fixes mode to
    Incremental and the target to the default (shown, not selectable) and hides "pin revision"; with `canFullBuild`
    mode and target are free; "pin revision" only for developers.
  - New **scope** field in the dialog for everyone who can build: "Limit to folder" (pages folder picker) and/or
    "Only these pages" (page picker) → `folderPath` / `assetUuids`; the dry-run preview (M22) reflects it.
  - Cancel per row only when `canCancelRun(run)`; Promote only with `canPromote`.
  - Run list and details show `comment` and "Started by <name>" (and "Scheduled" when the audit/run says so, if M27
    exposes the schedule link on the run).
  - Targets card: create/edit/delete buttons follow `canManageTargets` (create DEVELOPER, edit/delete PROJECT_ADMIN,
    as the API).
- **Release surfaces (M27).** Release, Discard, Unpublish in asset editors and the Changes view follow `canRelease`;
  Schedule follows `canScheduleRelease`; in the schedule dialog "then generate" is available only with
  `canIncrementalBuild`, other targets only with `canFullBuild`; `GENERATION` / recurring schedule creation only with
  `canScheduleGeneration`. Edit/cancel/take-over per schedule row follow the server rules (own + requirements, or
  developer).
- **Build now.** After a successful release, a success toast/banner offers **Build now** (incremental, default
  target) when `canIncrementalBuild`; it starts the run and links to its progress.
- A user without any of the capabilities sees an explanatory empty state on the generation screen ("Builds are
  started by developers in this project."), not a dead button.

## Acceptance criteria

- [ ] Vitest per surface: controls present/absent/disabled for editor with each permission set, developer, viewer,
      read-only; dialog restrictions (fixed mode/target, no pin revision); `canCancelRun` own vs foreign run.
- [ ] Scope fields send `folderPath`/`assetUuids` in the request shape of the generated schema.
- [ ] Manual check in the running app as editor with (a) nothing, (b) `RELEASE` + `INCREMENTAL_BUILD`, (c) all four;
      and as developer (unchanged).
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- New server rules (all in `M28.2.x`); the policy card (`M28.3.2`).

## Notes / hazards

- Editors reach the generation screen through Settings → Generation. If the journey shows that editors can't find
  it, add a "Builds" link in the project nav for users with `canIncrementalBuild` rather than moving the screen.
- The dry run for an editor must use the restricted request (incremental, default target) or it will `403`.
