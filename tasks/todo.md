# M27 feature 3 — Localized media (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/03-localized-media/`. Backend only; order 3.1 → 3.2.

- [x] M27.3.1 — `MediaFiles` (payload model: `localized`, `fileLocale`, `localeFiles`, `fileFor` along the chain),
      per-locale upload/replace/remove, `?locale=` on text/process/binary, toggle with `409 SF-MEDIA-0505` and pointer
      rekeying (carried like a system migration), projection per locale file, discard restores a locale's file,
      Changes candidates count localized media keys, DTO `localized`/`localeFiles`, problems `0505`–`0509`;
      fix: media versions written by metadata/process/text/restore writes lose the `mime_type` column
- [x] M27.3.2 — per-locale media outputs (`{localePrefix}assets/media/…`, own file or shared owner path, fallback
      copy when the owner doesn't publish it), references/processed media per render locale, manifest media locale,
      carry-forward per (media, locale), collision check, planner seeds locales that fall back to a changed locale,
      preview share URL serves the locale's file
- [ ] OpenAPI + `schema.d.ts`; full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`


## Review

- Backend as planned, plus small API additions the UI (`M27.6.4`) will need: `?locale=` on binary, thumbnail,
  process and the rendered binary; `localized` on list rows; `localeFiles` (every language → the file it renders, own
  or from which locale) on the media view. Design details are in each task's implementation notes.
- Design beyond the task text: `fileLocale` pins the top-level file to its language (survives a change of the default
  locale); one `MediaOutputs` rule for links, copies and carry-forward (a fallback links the owner's published file,
  or writes its own copy when the owner doesn't publish one); the planner re-seeds locales that fall back to a locale
  whose release changed; media outputs in the manifest carry their locale; page-vs-media path collisions are
  `SF-GEN-0110`.
- Fixed on the way: media versions written by metadata/process/text/restore/move/migration writes lost the
  `mime_type` column (the library's MIME filter and image pickers dropped them); `replace` lost localized alt text and
  caption; the per-build and preview text-media compile caches were keyed by media only (would have mixed locale
  sources).

---

# M27 feature 2 — Released rendering (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/02-released-rendering/`. Backend only; order 2.1 → 2.2 → 2.3.

- [x] M27.2.1 — `SnapshotView`, per-locale released views in `Snapshot` (unreleased = absent marker, like a
      tombstone), bulk pointer + version load; consumers locale-aware (planner site outputs, output paths, renderer,
      navigation, values, pagination, carry-forward, media copy); `SF-GEN-0221`; URL registry assigns the snapshot's
      path; test helper that releases fixtures; golden/per-locale/time-travel tests; benchmark number
- [x] M27.2.2 — release-seeded incremental planning (`ASSET_RELEASED`/`ASSET_UNPUBLISHED` roots, released-version
      edges, migration seeds nothing), impact endpoint answers "if released", invariant tests
- [x] M27.2.3 — preview `view=draft|published`, one view abstraction, navigation at the preview revision,
      `SF-DOM-0155`, headers, share-token `view` claim, link rewriting keeps the view; OpenAPI + `schema.d.ts`
- [x] Full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`


## Review

- Backend as planned, plus two small UI touches (root-kind labels "Released"/"Unpublished", chain text
  `… · released in r1902, en`) and regenerated `schema.d.ts` (`PlanEntryView.locale`, preview `view` params).
- Design beyond the task text (details in each task's implementation notes): a released `Snapshot` is a family of
  per-language views with "unreleased" absent markers (tombstone semantics for free); incremental planning walks once
  per language, which replaces M24's `LocaleValueDiff` narrowing; preview reads through `ContentView`, the live
  counterpart of the snapshot view; share tokens carry `view` only for `published`.
- Fixes found on the way: `LocaleProjection` ignored `folderId` (a record moved between sets of one folder could never
  be released, M27.1); a section's `$CMS_REF` resolved outside its page's language (M24); a revision preview showed
  the current navigation (task goal); the planner loaded every released version on each plan (benchmark).
- Tests: `ReleaseFixtures` releases fixtures before builds and runs the golden check (released view == draft view,
  byte for byte, whenever they hold the same versions) on every generation test; new
  `ReleasedGenerationIntegrationTest` (7), `ReleaseIncrementalPlanIntegrationTest` (6), `PreviewViewIntegrationTest` (5).
- `./gradlew build test --rerun`: 1265 tests, 0 failures (5 skipped benchmarks); planning classes re-run after the last
  `RebuildExpansion` change; `ui` `npm run build` and `npx vitest run` (79 files, 536 tests) green.
- Benchmark, 5,000 pages × 2 locales, machine under load (same load for both): full build 11.4 s (master 15.6 s),
  snapshot 158 ms (205), one-page dry run 594 ms (868), all-changed plan 2.0 s (310 ms — one walk per language plus two
  release-state loads).
- **Follow-up (M27.1 / M27.6):** releasing 10,000 items in one call took ~430–490 s (later calls 2–4 s): the first
  "release all" of a large project is far too slow. Not measured apart from the golden check in the same call, so
  profile before fixing — saved as task `M27.1.4` (`01-release-model/004-release-performance-large-selections.md`); suspects are per-item queries in `ReleaseServiceImpl.resolve`/completeness inside one large
  transaction.

---

# M27 feature 1 — Release model (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/01-release-model/`. Backend only; order 1.1 → 1.2 → 1.3.

- [x] M27.1.1 — `asset_release` (+ `released_uid`: a uid change writes no version), `AssetRelease`/repository,
      `ReleasableTypes`, `ReleaseLocales`, pure `LocaleProjection`, `ReleaseStatusService` (bulk, cached projections),
      `ReleaseState.at`, `ChangeType` RELEASE/UNPUBLISH/DISCARD, migration runner guarded by
      `project.release_state_initialized`, locale-set transitions (0→N copies `""` pointers to every locale,
      N→0 keeps the default locale's, removed locales close)
- [x] M27.1.2 — `ReleaseService` release/unpublish/discard/plan, dependency closure, completeness gate, delete
      semantics, `carryForward` for system migrations, restore untouched
- [x] M27.1.3 — `ReleaseController`, `ChangesController` (candidate query + diff), `release` block on DTOs, search
      facet, problems, OpenAPI + `schema.d.ts`
- [x] Full `./gradlew build` (`test --rerun`)

## Review

- Backend only, as planned. Design points beyond the task text (all in the task files' implementation notes):
  `released_uid` on the pointer (uid changes write no version); migration by startup runner + project flag;
  first/last locale transitions carry pointers; `ReleaseCarryForward` as its own component (bean cycle);
  restore/uid change/moves join an open batch so a discard is one revision; store roots not releasable.
- Follow-up for M27.3: `findChangeCandidates` counts one key for every media asset — localized media needs its
  locale count there.
- `./gradlew build test --rerun`: 1246 tests, 0 failures (4 skipped); re-run of the two late-edited test classes
  green; `ui` `npm run build` and `npx vitest run` (79 files, 536 tests) green after regenerating `schema.d.ts`.
- Benchmark 5,000 pages × 2 locales: migration 915 ms, project status 508 ms, Changes list 114 ms.

---

# M26 feature 5 — Docs and journey (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/05-docs-e2e/`.

- [x] M26.5.1 — spec §8.1–8.4, §9.2, §9.4, §20.2, §23, §24, §26 against the implemented behaviour; `infra/README.md`
      (`sf.security.password.*`, seeded admin, first steps in prod); `docs/administration.md`; deviations noted
- [x] M26.5.2 — `ui/e2e/m26-journeys.spec.ts` (two contexts, self-seeding), green twice on a clean dev stack;
      defects fixed with tests
- [x] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run`

## Review

- Docs: spec §8–§9, §20.2, §23, §24.5, §26.3, Appendix B; `docs/api.md`, `infra/README.md`, new
  `docs/administration.md`, `docs/user-guide.md`. Deviations between plan and code recorded in `M26.5.1`'s notes
  (epoch claim vs `iat`, own password change ends sessions, `LOCKED` keeps the session, `SF-API-0423` missing, no
  project-audit UI, no audit purge).
- Journey `ui/e2e/m26-journeys.spec.ts` green twice on a clean dev stack; defect found and fixed: the audit action
  filter hid the chosen actions (now chips, spec added).
- `./gradlew build test --rerun` 1185 tests green; `npm run build` green; `npx vitest run` 79 files, 536 tests green.

---

# M26 feature 4 — UI (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/04-ui/`. Frontend only; order 4.1 → 4.3 → 4.2 → 4.4.

- [x] M26.4.1 — `sf-user-menu` (dashboard header + nav rail), sign out, `/account` (profile, password with live
      policy checks, my projects, sign out everywhere), `/account/set-password` + `passwordChangeGuard` + `428`
      interceptor with return URL; self password change re-signs in with the new password (server revokes sessions)
- [x] M26.4.3 — Members tab (`settings/members`): read-only below `PROJECT_ADMIN`, lookup typeahead, role select,
      remove with self-removal warning
- [x] M26.4.2 — lazy `features/admin` (`/admin`, instance-admin guard): users list (server paging, debounced search,
      filters), create dialog (generate/set password, memberships, one-time password panel), detail (profile, actions
      with guard-rail reasons, delete by typing the username, memberships)
- [x] M26.4.4 — admin projects (archive/unarchive) and audit (filters in the URL); archived mode: `AuthStore.roleFor`
      is the effective role (instance admin → `PROJECT_ADMIN`, archived → `VIEWER`), `ProjectAccessStore.readOnly`
      (time travel or archived) replaces the `readOnly = timeTravel.isTimeTravel` aliases, banner + Unarchive
- [x] `npm run build`, `npx vitest run`; manual check in the running app (every task's manual list)

## Review

- UI: 79 spec files, 535 tests green (`npx vitest run`); `npm run build` green, `/admin` a lazy chunk (85 kB raw).
- Manual check: scripted Playwright walk against a dev backend on a scratch DB — every step of the four task files'
  manual lists, three green runs in a row; screenshots reviewed (fixed: create-dialog project row overflow, projects
  table action cell, "Viewing a past revision" notices in archived projects, raw role names on My account).
- Found and fixed: a revoked access token sent to `/auth/refresh` made the refresh fail (users signed out on every
  membership change since M26.1) — client no longer sends it, server ignores it (test added).
- Backend touch-ups for the forms: `field` on `409` duplicate username/email and on a wrong current password.

---

# M26 feature 3 — Admin API (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/03-admin-api/001-admin-projects-and-audit-api.md`. Backend only.

- [x] Domain: `AuditService.search(AuditFilter, page)` (JPA `Specification`, newest first by `created_at, id`),
      `AuditService.actions()`; `ProjectService.overview(q, includeArchived)` with member counts and head revisions
- [x] Changelog: indexes `audit_log(action, created_at)` and `(actor_user_id, created_at)` (`created_at` exists)
- [x] `GET /admin/projects`, `GET /admin/audit`, `GET /admin/audit/actions` (instance admin only)
- [x] API tests: each filter, combined, `_instance`, stable paging, `403`, member count / last change
- [x] Docs (`docs/api.md`), OpenAPI + `schema.d.ts`, `./gradlew build` (`test --rerun`), UI build + vitest

## Review

- Backend: 1184 tests green (`./gradlew build test --rerun`); new `AdminProjectsAndAuditApiTest` (7): every audit
  filter alone and combined, `_instance`, stable paging with equal timestamps, bad input, `403`/`401`, member counts
  and last change before and after membership revisions, text and archived filters.
- UI: `schema.d.ts` regenerated (three admin endpoints); `npm run build`, `npx vitest run` (63 files, 460 tests) green.

---

# M26 feature 2 — Archived projects (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/02-archived-projects/001-archived-projects-read-only.md`. Backend only.

- [x] Error code for "Project is archived": `SF-DOM-0141` (user decision; `SF-DOM-0130` is taken)
- [x] `ProjectWriteGuard` (sf-domain): one place that throws `409` for an archived project
- [x] Central guard in `RevisionServiceImpl.allocate` (covers `allocateOrJoin`/`beginBatch`)
- [x] `archive`: allocate first, then flip; new `unarchive`: flip first, then allocate; both audit
      (`PROJECT_ARCHIVED`/`PROJECT_UNARCHIVED`) and bump every member's epoch; `POST /projects/{key}/unarchive`
- [x] Hidden: `JwtServiceImpl` omits archived projects from `projects`; `GET /projects` filters for non-admins
- [x] Explicit guards on writes without a revision: generation start/promote/retry, share links (issue → 409,
      render → 404), search reindex, plus whatever the walk finds
- [x] User delete removes memberships of archived projects on purpose (guard bypass), with a test
- [x] Startup runners don't fail on an archived project
- [x] Endpoint walk test (`RequestMappingHandlerMapping`, allowlist with reasons)
- [x] Integration tests per acceptance criterion (still-valid token → 404, admin reads + writes 409,
      share link 404, generation 409, unarchive restores role + search)
- [x] Spec Appendix B row, OpenAPI + `schema.d.ts`, `./gradlew spotlessApply build` (`test --rerun`), `npm run build`
- [x] Early `ArchivedProjectInterceptor` + `@AllowedOnArchivedProject` (needed for a meaningful walk: validation
      otherwise answers `400` before the revision guard is reached)

## Review

- Backend: 1177 tests green (`./gradlew build test --rerun`); new `ArchivedProjectIntegrationTest` (7) and
  `ArchivedProjectEndpointWalkTest` (60+ handlers), `RevisionServiceImplTest` +2.
- Walk negative control (interceptor off) failed as expected and exposed an unguarded write: URL-registry
  reset/override and generation targets allocate no revision — now guarded in the domain/controller.
- UI: `schema.d.ts` regenerated (`unarchive`); `npm run build` and `npx vitest run` (63 files, 460 tests) green.
- Not changed: search stays unavailable for an archived project (index closed, pre-existing M23 behaviour).

---

# M26 feature 1 — Accounts (implementation, branch `m26-user-management`)

Spec: `tasks/26-m26-user-management/01-accounts/`. Backend lane, sequential (shared `UserService`,
`AuthService`, Gradle build). Implemented and committed as one change (the three tasks share `UserService`).

- [x] M26.1.1 — account model, password policy, forced change (`428`), immediate revocation, admin seeding
  - [x] changelog `019-user-management.xml` (`must_change_password`), `UserStatus.DELETED`
  - [x] `PasswordPolicy` + `sf.security.password.*` (+ unit tests)
  - [x] `PasswordChangeRequiredFilter` after bearer auth, exact allowlist; `/auth/me` gains `mustChangePassword`
  - [x] epoch bump in `setMemberRole`/`removeMember`; refresh rejects `DISABLED`/`DELETED` and drops the family
  - [x] `DELETED` treated like `DISABLED` in login and converter
  - [x] `DevAdminInitializer`: only into an empty table, `mustChangePassword` outside dev/demo/test
  - [x] audit `USER_PASSWORD_CHANGED`; integration tests per acceptance criterion
- [x] M26.1.2 — `/admin/users/**`, member lookup, private member emails
- [x] M26.1.3 — self-service `/auth/me` PATCH, password policy on change, `sessions/revoke`, `password-policy`
- [x] `./gradlew spotlessApply build` (`test --rerun`), OpenAPI + `schema.d.ts`, `npm run build`

## Review

- Backend: M26.1.1–1.3 together. New tests: `PasswordPolicyTest`, `UserAdministrationServiceTest`,
  `DevAdminInitializerTest`, converter cases, `AccountSessionRulesIntegrationTest`, `AdminUserApiTest`,
  `SelfServiceAccountApiTest`, `ConfiguredPasswordPolicyIntegrationTest`. Full `./gradlew build` green.
- UI: regenerated `schema.d.ts`; `npm run build` and `npx vitest run` (63 files, 460 tests) green. No UI code yet
  (M26.4): with a forced password change pending, today's UI would just see `428`s.
- Found on the way: a non-admin hitting any `hasAuthority` endpoint got `500` (fixed: `AccessDeniedException` → `403`).
  For M26.2.1 (noted in its task file): `SF-DOM-0130` is already taken, and the anonymizing delete must be able to
  remove memberships of archived projects once the central write guard exists.

---

# M25 — Record sets (implementation, branch `m25-record-sets`)

Spec: `tasks/25-m25-record-sets/`. One subagent per task; backend lane sequential (shared Gradle build and
service classes), UI lane parallel once the API exists. Each task is reviewed, tested and committed before the
next one in its lane starts.

## Backend lane
- [x] M25.1.1 — `RECORD_SET` asset type, containment, `RecordSetService`
- [x] M25.1.2 — stored set query: validation, evaluation, rename rewrite, broken-query flags
- [x] M25.2.1 — per-channel record templates on `DATASET`
- [x] M25.3.1 — `RecordSetController`, record create by set, DTOs, `schema.d.ts`
- [x] M25.2.2 — `recordset:` values, loops, reference editor, golden files
- [x] M25.2.3 — incremental planning + build insight
- [x] M25.4.1 — export/import

## UI lane (after M25.3.1)
- [x] M25.5.1 — Content store record sets
- [x] M25.5.2 — dataset record template editor
- [x] M25.5.3 — reference picker, search, routing

## Follow-ups found in review
- [x] Set grid: `revision` param on `GET /record-sets/{uuid}/records` (time travel lists records as of that
      revision) and a per-row `selectedBySet` flag in "All records" mode — replaces the UI's extra
      `_uuid == … || …` request for dimming (backend after M25.2.2, then UI)
- [x] Insight UI: `EDGE_LABELS` in `features/generation/insight/insight.util.ts` for `RECORD_SET_MEMBERSHIP`,
      `RECORD_SET_QUERY`, `RECORD_TEMPLATE`
- [x] Record template live check: `POST /octl/validate` gains a dataset context (`datasetUuid` + draft CDL) so
      unknown fields show while typing, not only on save (backend, then `dataset-schema-editor`)

- [x] Import UI: gate Proceed on `blocksImport` (not any BLOCKING), `RECORD_OUTSIDE_RECORD_SET` reads "will not be
      imported", icon for `RECORD_SET_QUERY_INVALID`; regenerate `schema.d.ts` (`blocksImport` fields)

## Finish
- [x] M25.6.1 — docs + spec
- [x] M25.6.2 — Playwright journey
- [ ] Full `./gradlew build` (`test --rerun`), `npm run build`, `npx vitest run` green; merge to master

---

# Project settings — merge tabs

Collapse the nine project-settings tabs to five:

- **General** = General + Channels + Languages + Media (in that order)
- **Generation** = Targets + Generation (in that order)

remaining tabs: General · Generation · Revisions · Navigation URLs · Import / Export.

## Approach

Composition, not code moves. Each existing tab component keeps its template, styles, state and API calls;
two thin container components (`ProjectSettingsGeneralViewComponent`, `ProjectSettingsGenerationViewComponent`)
stack them as sections and own the page scrolling. Only the section chrome changed — heading level and the
`height: 100%` / `overflow: auto` the children used to need as route roots.

## Steps

- [x] `project-settings-general-view.component.{ts,html,scss}` — General, Channels, Languages, Media
- [x] `project-settings-generation-view.component.{ts,html,scss}` — Targets, Generation
- [x] Children become plain blocks: drop `height: 100%` / `overflow: auto` from `:host` and from the
      top-level wrapper in `project-settings-{general,media,locales,targets}`, `channels`, `generation` SCSS
- [x] Demote section titles `h1` → `h2` in locales / targets / channels / generation (one heading level
      under the shell's sr-only `h1`)
- [x] `app.routes.ts`: `general` and `generation` point at the containers; `media`, `locales`, `channels`
      redirect to `general` and `targets` to `generation`, so old deep links (and the Playwright journeys)
      still land on the content
- [x] `project-settings-shell.component.html` + class doc: remove the Channels, Languages, Media, Targets tabs

## Review

- `npx ng build` green; only pre-existing warnings (NG8102 in globals/templates, SCSS budget).
- `npx vitest run`: 20 spec files fail with `resolveComponentResources` — verified identical on a clean
  `git stash`ed tree, i.e. the known broken `templateUrl` spec runner, not this change.
- No e2e tests written or run (as requested). The `settings/channels`, `settings/locales` and
  `settings/generation` journeys in `e2e/m16`, `m22`, `m24` keep working through the redirects.
- Visual check in the running app skipped at the user's request (login form needs a password).

---

# UI unit suite — fix the 85 failing vitest tests

Started at `20 failed | 28 passed` files / `85 failed | 240 passed` tests; ended at **48 / 327 green**.

## Root cause (one config bug, ~70 of the 85)

`ui/vitest.config.ts` had no Angular plugin, so `templateUrl` / `styleUrl` were never inlined and every
component with external resources died in JIT with
`Component 'X' is not resolved … Did you run and wait for 'resolveComponentResources()'?`.

- [x] `vitest.config.ts` → `vitest.config.mts` with `@analogjs/vite-plugin-angular` (`jit: true`,
      `inlineStylesExtension: 'scss'`). `.mts` because the plugin is ESM-only and a CJS-transpiled
      `.ts` config cannot `require` it.
- [x] Pin `@analogjs/vite-plugin-angular` to `1.13.1` — the floating `^1.9.0` had resolved to `1.22.5`,
      which imports `defaultClientConditions` from Vite 6 while vitest 2.1.9 brings Vite 5.
- [x] `src/test-setup.ts`: import `@angular/core/testing` at module scope instead of inside `beforeAll`.
      It registers the global TestBed-reset `beforeEach`/`afterEach` as a load side effect; from a hook
      that is too late, and every raw-TestBed spec failed with "test module has already been instantiated".
- [x] `src/test-setup.ts`: jsdom shim for `URL.createObjectURL` / `revokeObjectURL` (missing in jsdom, and
      `vi.spyOn` throws on an absent property).

## Per-spec fixes (stale specs the broken runner had been hiding)

- [x] `global-set-detail`, `project-settings-import` — `provideHttpClient()` + `provideHttpClientTesting()`
      for the `EditingLocaleStore → LocalesStore → ApiClient` chain M24 introduced
- [x] `project-settings-export` — stub the `globalsFolderTree` / `contentFolderTree` signals the component reads
- [x] `templates` — `provideRouter([])` (component now injects `ActivatedRoute`); flush `[]` rather than
      `{ content: [] }` for the bare-array `/channels` and `/datasets` endpoints
- [x] `navigation` — fixture wrapped in the fixed "All Navigation" root the tree endpoint always returns
- [x] `nav-reference-detail` — expect the trailing `locale` argument M24 added to `updateReference`
- [x] `pagination-editor` — a second `detectChanges()`: constructor effects read the control only after the
      creation pass. Stale "can't run in this workspace" note dropped from the spec and the component doc.
- [x] Query/change-detection hygiene across `sf-create-asset-dialog`, `sf-rename-asset-dialog`, `pages-list`,
      `revision-diff`, `project-settings-url-registry`, `project-settings-import`: `getByRole('button', …)`
      instead of `getByText` (which resolves to the inner `<button>`, so `.closest('button')` and
      multiple-match errors both bite), and `fireEvent` / `findBy*` where an assertion needs the pass after
      the event.

## One implementation change (agreed with the user)

`sf-create-asset-dialog.component.html` — the submit button was `[disabled]="form.invalid || submitting()"`,
which made the `markAllAsTouched()` guard inside `submit()` unreachable: clicking Create with a blank name
did nothing and explained nothing. Now `[disabled]="submitting()"`, matching `sf-rename-asset-dialog`.

## Review

- `npx vitest run` → **48 files / 327 tests, all passing**.
- `npx ng build` → green, only the pre-existing NG8102 and SCSS-budget warnings.
- No e2e run.
