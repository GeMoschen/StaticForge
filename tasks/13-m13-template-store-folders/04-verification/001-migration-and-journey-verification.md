---
id: M13.4.1
status: todo
depends: [M13.1.1, M13.1.2, M13.1.3, M13.1.4, M13.2.1, M13.2.2, M13.3.1, M13.3.2, M13.3.3]
epic: m13-template-store-folders
feature: verification
area: qa
---

# M13.4.1 — Migration + end-to-end journey verification

## Context

Every prior task in this milestone has its own acceptance criteria/tests;
this task is the integration pass proving they compose correctly as one
user-facing flow, and specifically stress-tests `M13.1.4`'s migration
against data that looks like a real, already-in-production project rather
than a fresh fixture.

## Goals

- Backend integration test (new, or extending an existing
  `*IntegrationTest`/`*JourneyIntegrationTest` in `server/sf-app/src/test`,
  matching the style of `M8NavigationJourneyIntegrationTest`/
  `ProjectExportImportIntegrationTest`): full lifecycle — create folders
  under both fixed roots, create page/section templates in them, move a
  template between folders, attempt (and confirm rejection of) a cross-kind
  move, export the whole `TEMPLATES` store, import into a second project,
  assert the fixed folders in the target weren't duplicated and every
  asset landed in the right place.
- Migration fixture test: seed a project the way it would have looked
  before this milestone (templates created with no `parentFolderUuid`,
  multiple revisions, at least one `saveChannel` edit creating channel
  template history), run `M13.1.4`'s migration, assert every template
  landed under the correct fixed folder and that
  `AssetVersionRepository`/revision queries against that asset still
  return its full pre-migration history unchanged.
- Frontend: a Playwright journey (`ui/e2e/`, following the numbering
  convention `ui/e2e/README.md` documents) exercising the Templates screen
  folder tree (create folder, create template in it, move) and the
  export/import panel's new template tree scope — gated the same way
  existing journeys are if they depend on the demo seed (`SF_RUN_E2E`).
- Run `./gradlew clean build` and `ui`'s `npm run build`/`npm test`;
  fix any regression this milestone introduced (not pre-existing failures
  unrelated to this work — note those explicitly if found, don't attempt to
  fix unrelated flakiness).

## Acceptance criteria

- [ ] The backend end-to-end integration test passes.
- [ ] The migration fixture test passes and explicitly asserts revision
      history/channel data is unchanged post-migration.
- [ ] The Playwright journey collects/lists cleanly (`--list`) and passes
      where the environment allows running it.
- [ ] `./gradlew clean build` BUILD SUCCESSFUL; `ui` build/tests green.

## Out of scope

- New product behavior — if this task finds a real bug, note it and either
  fix it as a small, clearly-scoped addendum or flag it back to the owning
  M13.1/M13.2/M13.3 task rather than silently expanding this task's scope.

## Notes / hazards

- The migration fixture test is the highest-value test in this milestone —
  it's the one thing that runs against every existing project's real data
  shape. Don't shortcut it in favor of only testing the new-project happy
  path.
