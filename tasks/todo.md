# Generation targets — per-target output location + management UI — Plan

## Goal
1. Make a target's `config` decide where its output goes, so two projects or two targets
   stop sharing one `{outputRoot}/current` and one build-cleanup pool.
2. Add a Project Settings → **Targets** tab to list, create, edit, delete and set the default target.

## Problems today
- `TargetWriterSelector` ignores `config`; FILESYSTEM/ZIP write to `{outputRoot}/builds/{runId}`
  and `{outputRoot}/current` for *every* project; S3 mirror uses `{outputRoot}/s3/{targetName}`
  (collides across projects with the same target name).
- Nothing in the UI creates targets (only import does), so a fresh project cannot generate
  without calling the REST API by hand.
- `TargetController` allows several `isDefault` targets per project and does no validation.
- `GenerationService.resolveTarget` accepts a `targetId` from another project.

## Design
- Output root per target: `{outputRoot}/{projectKey}/{path}`.
  - `path` = `config.path` (optional), else `target-{id}`.
  - `config.path`: relative, `/`-separated segments of `[A-Za-z0-9._-]`, no `.`/`..`, no
    leading `target-<digits>` segment (reserved for defaults), ≤ 200 chars.
  - Must not equal, contain or sit inside another target's path in the same project.
  - Project keys are already restricted to `[a-z0-9_-]` and never change, so they're safe as a directory name.
- New `TargetLocations` helper (sf-generate `target` package): validates the path and
  resolves the directory (with a final `startsWith(outputRoot)` guard). Used by the selector and the controller.
- `TargetWriterSelector.forTarget(projectKey, target)`; all writers get the per-target root.
- `GenerationTargetView` gains `outputPath` (relative to the server output root, e.g.
  `acme/site`). The absolute server path is never exposed.
- Controller: name required (≤120), path validated + overlap-checked → 400; setting
  `isDefault` clears the other defaults in the project.
- UI keeps any other `config` keys it doesn't show when saving an edit.

## Steps
- [x] 1. Backend `TargetLocations` + unit tests (validation, fallback, overlap, escape guard).
- [x] 2. `TargetWriterSelector` / `S3TargetWriter` use the per-target root; update `GenerationService`
      call sites + project check in `resolveTarget`; update `GenerationServiceTest` mock.
- [x] 3. `TargetController` validation, single default, `outputPath` in view.
- [x] 4. Update integration tests that read `{outputRoot}/builds/...` (Generation, CrossProjectUuidCollision,
      NavigationUrlRegistry, M8NavigationJourney, benchmark if it reads paths); add
      controller API test (create/update/delete, bad path, overlap, single default).
- [x] 5. Regenerate `schema.d.ts` (`npm run generate:api` after server openapi build).
- [x] 6. `GenerationService` (UI): `updateTarget`, `deleteTarget`.
- [x] 7. `ProjectSettingsTargetsComponent` (list/create/edit/delete/default, time-travel read-only),
      route `settings/targets`, tab in shell; spec test.
- [x] 8. Generation page: when no target exists, link to the Targets tab.
- [x] 9. Docs: user guide, ADR-0005/architecture layout note, spec §18.4 layout, infra README.
- [x] 10. Verify: `gradlew test` (affected modules), `npm run build`, `npm test`.

## Review
- **Output layout:** `TargetLocations` (sf-domain) resolves `{outputRoot}/{projectKey}/{config.path | target-{id}}`
  and validates `config.path`. FILESYSTEM, ZIP and S3 writers all use that directory. The layout change is a clean
  break (user decision): existing `{outputRoot}/current` deployments must repoint their web servers, and runs from
  before the change can't be promoted.
- **Controller:** name validation; path validation and overlap check happen before save. An overlap can only happen
  between two configured paths, because `target-<n>` is reserved for the fallback. Saving a default target clears the
  flag on the others (previously two defaults made `findByProjectIdAndDefaultTargetTrue` throw). `outputPath` is now
  in the response.
- **Also fixed:** `resolveTarget` rejects a `targetId` from another project. Import no longer creates a second
  default target.
- **UI:** new Settings → Targets tab (list/create/edit/delete; unknown config keys are kept on edit; read-only in
  time travel). The generation dialog links to it when a project has no targets.
- **Verification:**
  - Unit tests: `TargetLocationsTest` (15) and `GenerationServiceTest` pass.
  - Integration tests: `TargetApiTest` (4), plus the Generation, CrossProjectUuidCollision, NavigationUrlRegistry,
    M8Journey and ExportImport (44) suites, pass.
  - Full backend suite: 173 tests, 1 failure in `ConcurrentWritersTest`. It's flaky: it passes on a clean master
    worktree and twice on this branch.
  - `ng build` (AOT) passes.
  - Ran the app (dev backend + ng serve, Playwright): created, edited and overlap-rejected targets in the UI; a real
    generation wrote `out/demo/site/builds/1`, `current` → 1, and the sitemap used the edited baseUrl. The dialog's
    no-target link goes to the Targets tab.
- **Not verified:** `project-settings-targets.component.spec.ts` could not be run. UI component specs with
  `templateUrl` fail locally (18 files / 68 tests, including existing specs) with `resolveComponentResources`;
  the `@analogjs/vite-plugin-angular` build doesn't match the installed Vite.
- **Follow-ups:** import doesn't check imported `config.path` for overlap; old builds under the legacy shared root are
  not cleaned up.

---

# Follow-ups — import path clashes + legacy output cleanup — Plan

## A. Import: imported `config.path` clashes
- Today import only skips targets whose *name* exists; an imported `config.path` can be invalid or
  overlap an existing target (or another imported target) → shared output folder.
- One planning helper decides, per archived target, in archive order: **skip** (name collision, as today),
  **import as-is**, or **import without `config.path`** (invalid path, or it overlaps an existing/earlier
  imported target) → falls back to `target-{id}`, which can never clash.
- `analyze` and `importSettings` both use that helper so the report always matches what import does.
- New `ConflictType.TARGET_PATH_COLLISION` (WARNING) with message naming the clashing target; UI icon entry.
- Tests: analyze reports it; import stores the target without `path`, other config keys kept; valid
  non-clashing path kept; clash between two imported targets.

## B. Legacy shared-root output cleanup
- Legacy entries directly under `sf.generate.output-root`: `builds/` (numeric dirs, `N.zip`, `N.zip.tmp`),
  `current` (marker file or symlink), `s3/`.
- Project keys can legally be `builds`, `current` or `s3`, so detection is conservative: an entry is legacy
  only if no project (incl. archived) has that key AND its shape matches the old layout
  (`current` is a file/symlink, `builds/` holds only numeric dirs / `N.zip[.tmp]`, `s3/*` holds numeric
  run dirs, `N.keys`, `current`). Anything unexpected is left alone and logged.
- Runs once at startup (ApplicationRunner) after the DB is up; each removal logged at INFO.
- Tests: removes legacy layout; keeps a project folder named `builds`/`s3`/`current`; keeps unrecognized
  content; no-op on empty root.

## Steps
- [x] A1 planning helper + analyze + importSettings + ConflictType + UI icon
- [x] A2 integration tests in ProjectExportImportIntegrationTest
- [x] B1 LegacyOutputCleanup + property gate (per decision)
- [x] B2 tests
- [x] Docs (ADR/infra README note), verify: affected test suites + full backend suite

## Review (follow-ups)
- **Import:** `TargetImportPlan` decides for each archived target: skip on name collision, import, or import
  without `config.path` if the path is invalid or overlaps an existing or earlier-imported target (user decision).
  Conflict analysis and import both use it, so the report always matches what import does. New `TARGET_PATH_COLLISION`
  warning; UI icon added.
- **Cleanup:** `LegacyOutputCleanup` (pure logic) plus `LegacyOutputCleanupRunner` (runs at startup; on by default,
  `sf.generate.cleanup-legacy-output=false` turns it off; user decision). An entry is removed only if no project owns
  the key and its contents match the old layout exactly. Each removal is logged.
- **Verification:**
  - `ProjectExportImportIntegrationTest`: 45/45, including a new clash test.
  - `LegacyOutputCleanupTest`: 5/5.
  - Full backend suite: 328 tests, 0 failures (1 skipped).
  - `ng build` passes.
  - Real boot with a seeded old-layout output root: `builds/`, `current` and `s3/` removed; `acme/site/...` and
    unrelated `notes/` kept.
- **Not covered:** a legacy `current` symlink wasn't tested on Windows (the writer never created symlinks there);
  the symlink branch only deletes the link itself.

---

# Bugfix — generation fails silently, history empty

## Root causes
1. **Failure:** templates written as documented (`$CMS_NAVIGATION(nav:root)$`, docs/navigation-template-syntax.md)
   failed validation with `SF-TPL-0110`. The navigation root's uid is `navigation_root`, and generation/preview
   deliberately reject the uid `root` (the hidden shared folder). Template save used a third resolver with
   no scope check, so the template saved fine.
2. **No error visible:** the live log hid itself as soon as the stream ended; run `diagnostics` were never rendered.
   If a run had already finished when the log subscribed, SSE sent one status frame, never completed, and
   leaked the emitter.
3. **History empty:** `GenerationComponent.load()` was never called; the table only showed runs started since the page opened.
4. **False PARTIAL:** the dialog always offered and pre-checked a hardcoded `markdown` channel, and the store's
   channel list was never loaded.

## Fixes
- [x] `FolderScope.navigationReferenceUid`: `nav:root` → `navigation_root`, used by the generation, preview
      and template-save resolvers; template save also applies the NAVIGATION-scope check.
- [x] SSE: events endpoint checks 404 first, then completes the stream right away for finished runs; emitter
      registration/removal is atomic, and empty lists are dropped.
- [x] UI: history loads on init (plus targets for labels); per-run Details (times, channels, target, revision,
      output, diagnostics); the live log stays open with final status + messages; removed the broken
      "Rollback" (it promoted the failed run itself); Promote is offered for PARTIAL too.
- [x] Dialog loads the project's enabled channels.
- [x] Docs: `nav:root` alias.

## Review
- Tests: `GenerationRendererNavigationTest` (9, including new nav:root test), `GenerationIntegrationTest` (3: nav:root
  saves+generates SUCCESS; nav:pages_root rejected on save), `GenerationEventsApiTest` (fails without fix,
  passes with it), `generation-diagnostics.spec.ts` (3).
- Running app: history shows old FAILED run with Details message; a new failing run keeps the log open with
  `SF-TPL-0110 …`; after removing the broken page, the nav:root template generates SUCCESS with the nav rendered
  and only the html channel.

---

# Bugfix — URL registry race + broken links on nested pages

## Root causes
1. **`null id in UrlRegistryEntry … don't flush the Session after an exception occurs`:** pages render on
   parallel virtual threads, and every page renders the same navigation, so threads race to insert the same
   registry tuple. `computeAndPersist` caught the unique violation from `save` and re-read inside the same
   transaction, but the failed entity stayed in the session (the re-read's auto-flush threw) and the
   transaction was rollback-only. The old race test used mocks, so it could not catch this.
2. **Links broken below the root:** generation emitted root-relative paths without a leading slash
   (`pf/p2.html`), which resolve against the current page's folder. User chose root-absolute links (spec §18.3 form).

## Fixes
- [x] `UrlRegistryRepository.insertIfAbsent` (`INSERT … ON CONFLICT DO NOTHING`) + re-read; no exception on a lost
      race, no poisoned session, no second connection.
- [x] Real concurrent integration test (16 virtual threads, same tuple): failed with the exact user error before,
      passes after (3 reruns). Mock unit test updated to the new contract.
- [x] `GenerationRenderer.siteUrl`: root-absolute hrefs for `$CMS_REF` page/folder/media and nav hrefs
      (registry-backed and folder nodes); already-absolute values unchanged; registry storage unchanged.
- [x] Test expectations updated; `GenerationRendererSiteUrlTest` added; docs/navigation-html-output.md.

## Review
- Running app, pages `p1`, `pf/p2`, `pf/pf1/p3` + nav refs + `nav:root` + `$CMS_REF(page:p1)`: runs SUCCESS
  (also with an empty registry); every page links `/p1.html`, `/pf/p2.html`, `/pf/pf1/p3.html`.
- Not verified on real PostgreSQL (no Docker here); `ON CONFLICT DO NOTHING` is native PostgreSQL syntax and
  works in H2's PostgreSQL mode used by dev/test.

## Correction — relative links (user)
- The user wants links inside a page resolved **relative to the current page**, not root-absolute.
- [x] `GenerationRenderer.relativeUrl(pagePath, sitePath)` replaces `siteUrl`; each page's output path is passed to the
      URL/block/navigation resolvers and section renders. Applies to nav hrefs and `$CMS_REF` page/folder/media.
      Absolute values (`/…`, schemes, `#…`) are unchanged; registry storage unchanged.
- [x] Tests: `GenerationRendererRelativeUrlTest` (4: root, nested, directory targets, absolute/blank),
      a nav render from a nested page (`../../home.html`); root-absolute expectations reverted.
- Running app: `p1`, `pf/p2`, `pf/pf1/p3` all SUCCESS, e.g. p3 links `../../p1.html`, `../p2.html`, `p3.html`;
  a link checker resolved all 12 generated hrefs to existing files.
