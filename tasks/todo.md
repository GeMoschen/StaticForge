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
