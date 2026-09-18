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
