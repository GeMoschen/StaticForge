---
id: M28.3.1
status: done
depends: [M28.1.1]
epic: m28-editor-publishing
feature: ui
area: frontend
---

# M28.3.1 — `ProjectPermissionsStore`: one permission helper for the app

## Context

`core/auth/auth.store.ts` (`roleFor`: instance admin → `PROJECT_ADMIN`, archived → `VIEWER`),
`core/auth/auth.guard.ts` (`ROLE_RANK`, `roleRank`, `projectMemberGuard`), `core/project/project-access.store.ts`
(`readOnly` = time travel or archived), `core/project/project-context.store.ts` (loads `ProjectDetail`), ad-hoc checks
in `features/content/content.component.ts`, `dataset-schema-editor.component.ts`, `record-editor.component.ts`,
`record-set-view.component.ts`, `features/globals/global-set-detail.component.ts`,
`features/search/search-page.component.ts`, `features/settings/project-settings-members.component.ts`.
`ProjectDetail.permissions` / `publishPolicy` (`M28.1.1`). Epic decisions 12, 13.

## Goals

- `ProjectPermissionsStore` (`core/project/`, root-provided, signals): inputs = effective role (`AuthStore.roleFor`),
  `ProjectDetail.permissions` (kept by `ProjectContextStore`), `ProjectAccessStore.readOnly`. Exposes
  `canEditContent`, `canEditTemplates` (DEVELOPER+), `canManageMembers`, `canManageTargets`, `canRelease`,
  `canScheduleRelease`, `canIncrementalBuild`, `canFullBuild`, `canCancelRun(run)` (own run with a build permission,
  or DEVELOPER+), `canPromote`, `canScheduleGeneration` (DEVELOPER+), `canAdminProject`. Every write capability is
  `false` while `readOnly`.
- Replace every ad-hoc `ROLE_RANK`/`roleRank`/`roleFor(...) === …` check in the components listed above with the
  store (the route guard `projectMemberGuard` keeps `roleRank` internally).
- **Stale policy.** An HTTP interceptor (or the existing error handling) recognises `403` with a `permission`
  extension: reload the project detail through `ProjectContextStore` and show "You no longer have permission to
  <action>." (map permission → wording in one place).
- `ProjectContextStore` refreshes `ProjectDetail` when the user returns to the tab (visibilitychange) at most once
  a minute, so toggled permissions show without a reload.

## Acceptance criteria

- [x] Vitest: store truth table per role × permissions × readOnly (fixtures built from the generated
      `ProjectDetail` type, lessons "spec fixtures must have the API's real shape").
- [x] Grep shows no `roleRank(`/`ROLE_RANK` outside `core/auth/` and the store; the migrated components' existing
      specs pass unchanged in behaviour.
- [x] `403` with `permission` refreshes the detail and shows the message once (spec with a mocked response).
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Using the store in the publishing surfaces (`M28.3.3`) and the policy card (`M28.3.2`).

## Notes / hazards

- The server stays the authority; the store only hides/disables controls. Never compute publish permissions from the
  role in the UI — read `permissions` (decision 12), otherwise the UI and server disagree the moment a rule changes.
- Keep `roleFor`'s archived → `VIEWER` lowering: an archived project's detail still lists permissions, but
  `readOnly` must win.
