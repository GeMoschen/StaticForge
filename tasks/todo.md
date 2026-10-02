# M35 — UI/UX overhaul

Spec: `tasks/35-m35-ui-ux-overhaul/`. User decisions (2026-09-30) and planning findings there. New professional,
clean, enterprise-dense visual identity (Inter, blue accent, light/dark/system, compact/comfortable), top bar + rail
frame, role-adaptive (permissions + developer mode), keyboard-first, per-user server preferences, one design system on
every screen. Screen migration starts only after the style guide (M35.9) is signed off.

- [x] M35.1 functional bugs from the UX run
- [x] M35.2 decompose large components (behaviour-preserving)
- [x] M35.3 user preferences API + client store
- [x] M35.4 Transloco setup + string extraction rules
- [x] M35.5 design tokens v2, theme (light/dark/system), density
- [x] M35.6 base components and form controls
  - [x] Foundation: `SF_FIELD` context + `SfControl` base (CVA, ids, describedby, invalid, readonly), anchored
        positioning util, `sfTooltip` (rewrite), `sf-button` v2 (backward compatible), minimal `sf-menu` (menu button —
        M35.7 extends it with context menu/submenus), `shared.*` i18n keys
  - [x] `sf-field` v2: `<label for>` instead of a wrapping `<label>`, required/optional, hint + error, `aria-describedby`/
        `aria-invalid` (own controls via DI, projected native controls via DOM), group label for radios/checkboxes,
        label top/inline
  - [x] Text controls: input, textarea, select, number, date/time/datetime, search (clear,
        Escape, `/`), color, file picker with drop zone
  - [x] Choice controls: checkbox, radio group, switch, segmented, combobox (single/multi, type-ahead, ARIA 1.2)
  - [x] Display: badge, status, tag, kbd, avatar, copyable, relative-time
  - [x] `sf-tabs`: router mode (`<a>` + `aria-current`), overflow "More" menu
  - [x] Layout: page-header, toolbar, section, empty-state v2, skeleton, banner; spinner styles out of inline `styles`
  - [x] Verification: `npx vitest run`, `npx ng build`, `npm run lint`, components checked in a browser (themes, densities, popups in a clipping box)
  - [x] Follow-up (user): slider, and a custom date/time picker (calendar dialog + time list) instead of the native pickers
  - Review: see `35-m35-ui-ux-overhaul/006-base-components.md` (1,437 tests green, build + lint green, checked in Chrome)
- [x] M35.7 overlays: dialog, confirm, drawer, popover, menu, toast
  - [x] Overlay core `OverlayStack` (in-house, no CDK): focus trap + restore, scroll lock, `inert` background, Escape,
        stacking on the z-index scale; used by created dialogs and declarative drawers/popovers
  - [x] `DialogService.open(component, data)` → typed `SfDialogRef`, `sf-dialog` chrome (sizes, h2 title, scroll body,
        footer), `ConfirmService.confirm()` (tone, typeToConfirm, details, irreversible note); old `DialogService`
        consumers (media usages, revision diff, locales, URL registry) migrated, old API removed
  - [x] `sf-drawer` (right, modal/non-modal, keyboard-resizable edge until M35.8's splitter), `sf-popover` (click/focus
        trigger, Escape, outside click, route change)
  - [x] `sf-menu`: submenus, shortcut hints, disabled with reason, groups; `ContextMenuService` with a keyboard anchor
        (Shift+F10 / Menu key `contextmenu` anchors to the element), `sf-context-menu` on the menu panel
  - [x] Toasts: max visible + queue, Undo with countdown, pause on hover/focus, lifetime from text and action
  - [x] `lint:dialogs` script (warning; error in M35.27) + list of remaining `window.*` calls for the screen tasks
  - [x] Verification: vitest, ng build, lint, check in Chrome
  - Review: see `35-m35-ui-ux-overhaul/007-overlays.md` (1,512 tests green, build + lint green, checked in Chrome)
- [x] M35.8 data table, tree, splitter
  - [x] Virtual scroll primitive (no CDK): pure window maths + `sfVirtualScroll` directive, density-aware row height
  - [x] `sfSeparator` handle directive (role=separator, keys, pointer, double click) shared by `sf-splitter` and the
        drawer edge; `sf-splitter` (horizontal/vertical, min/max, collapse/restore, persisted per pane id)
  - [x] `sf-tree` (data-driven, replaces the empty wrapper): lazy children, ARIA tree, full keyboard, multi-select,
        F2/Del/clipboard/context menu, ⋮ button, filter, persisted expansion, drag and drop + keyboard move, inline
        create/rename, truncation rule, skeleton, virtualized
  - [x] `sf-data-table`: columns (templates, multi-sort, resize, hide, reorder, chooser persisted), sticky header/first
        column, selection + bulk bar, row keyboard, filter bar synced to the URL, paging/infinite, states, virtualized
  - [x] Verification: vitest, ng build, lint, 5,000-node tree and 1,000-row table smooth in Chrome
  - Review: see `35-m35-ui-ux-overhaul/008-table-tree-splitter.md` (1,620 tests green, build + lint green, checked in Chrome)
- [x] M35.9 style guide + **design gate (user sign-off)**
  - [x] Chrome tokens for the dark top bar (both themes), product mark SVG + favicon
  - [x] `/styleguide` route (instance admins; anyone in dev builds), lazy chunk, sticky index, theme/density switches
  - [x] Token sections: colours with live contrast values, type scale, spacing, radius, elevation, z-index
  - [x] Component sections: buttons, forms, display, layout, overlays, tree/table/splitter — all states
  - [x] Sample screen `/styleguide/sample`: dark top bar + rail, tree → folder table → page editor (outline, form,
        preview), developer mode toggle, fake data
  - [x] Specs (route guard, index, contrast maths, sample navigation), vitest + ng build + lint
  - [x] Screenshots with headless Chrome → Artifact gallery; **user sign-off** recorded in the task file
  - [x] Review round 1: cards/catalogs, content + datasets, templates + code panel (two palettes), media, navigation
        (sibling reorder), globals, changes, schedules, publishing + settings (`sf-side-nav`); decisions 7–34
  - Review: signed off 2026-10-01 (gallery v4, 198 shots / 45 screens); 218 test files / 1,863 tests, build + lint
    green; design-system review found 12 defects, all fixed with specs. Open: palette pick (before M35.21), drawers
    over the top bar (before M35.19) — see 009 notes.
- [x] M35.10 app frame: top bar, rail, developer mode, titles
  - [x] Core (pure, specced): frame location from URL, breadcrumb builder (collapse middle), rail visibility matrix,
        document title composer + `TitleStrategy`, `DeveloperModeService` + `*sfDevOnly`, `FrameContextStore` (item trail)
  - [x] Preferences: `developerMode` unset = on for developers; `favoriteProjects`, `recentProjects`; rail state from
        preferences (not `localStorage`)
  - [x] Frame components (`features/frame`): app frame (header / nav / banner region / main), top bar (mark, project
        switcher, breadcrumb, search, editing language, build status + Build now, History, appearance, `?`, user menu),
        rail (Home, Content, Publish, Develop, Settings; admin sections), shortcut sheet (minimal, M35.14 extends)
  - [x] Routes: one frame parent for dashboard / account / admin / project; every route gets a `title`; project shell
        reduced to project effects; admin + account lose their own bar, tabs and centering; old rail / user menu removed
  - [x] i18n `frame.*`, specs (breadcrumb, switcher, visibility matrix per role, titles), vitest + ng build + lint,
        manual check in Chrome with screenshots (light/dark, compact/comfortable, rail collapsed, editor view)
  - Review: 229 test files / 1,930 tests, build + lint green; checked in headless Chrome against a seeded backend
    (admin + editor, light/dark, compact/comfortable, collapsed rail, dev mode off, 1440/1024). Open items for later
    tasks are listed in the 010 task file.
- [x] M35.11 IA: Publishing area, Settings side menu + split
  - Review: see `35-m35-ui-ux-overhaul/011-information-architecture.md` (route table, redirects, area shell); 1,971 tests, build + lint green
- [ ] M35.12 history drawer, full history, time-travel banner (spine removed)
- [ ] M35.13 save UX, unsaved guards, confirm + undo
- [ ] M35.14 keyboard-first: shortcut registry, palette actions, `?` sheet
- [ ] M35.15 recents and favorites
- [ ] M35.16 login, account, admin
- [ ] M35.17 content form and editors
- [ ] M35.18 pages
- [ ] M35.19 media
- [ ] M35.20 content: record sets and records
- [ ] M35.21 templates IDE
- [ ] M35.22 navigation and globals
- [ ] M35.23 changes, schedules, release dialogs
- [ ] M35.24 publishing, quality, redirects, URL registry
- [ ] M35.25 settings sub-pages, members, import/export
- [ ] M35.26 search page
- [ ] M35.27 tablet layout and review mode
- [ ] M35.28 dashboard 2.0 and project home
- [ ] M35.29 preview upgrades
- [ ] M35.30 visual regression baselines
- [ ] M35.31 journeys on the new UI
- [ ] M35.32 spec §23/§24 and docs

# M34 — CDL tabs and one save

Spec: `tasks/34-m34-cdl-tabs-one-save/`. User decisions (2026-09-30) there. The CDL of templates, datasets and global
sets is stored and edited as its sections (`contentCdl`, `bodiesCdl`, `rulesCdl`), one tab each; channel templates
are tabs beside it; one Save writes a holder's CDL, channels (or values) as one revision.

- [x] M34.1 CDL sections in the compiler (`CdlSources`, `compile(CdlSources)`, `Diagnostic.field`)
- [x] M34.2 payload, API and domain on sections (no migration: no real data yet)
- [x] M34.3 global set: schema and values in one save
- [x] M34.4 UI: `sf-tabs`, `sf-cdl-sections-editor`, split view, staged channels, one Save, `Ctrl/Cmd+S`
- [x] M34.5 spec + docs + journeys

## Review

Verification (2026-09-30): `./gradlew test` green except the known Linux-only
`GenerationIntegrationTest.fullGenerationReachesSuccessAndPublishesOutput` (`current` is a symlink); `spotlessCheck`
could not run (Maven Central answered 429 for the formatter), its rules (unused imports, trailing whitespace, final
newline) checked by script; `npx vitest run` green; `npx ng build` green (only pre-existing warnings); OpenAPI
regenerated, matching the hand-edited UI types. Journeys against a dev backend: m17 (4/4), m19 (4/4) green; m20 and m21
pass every template step and then fail reading generated files — those journeys predate M27 and never release their
pages, so a build renders nothing (same for the output checks of m16, m27, m29). m18, m22, m24 and m25 fail in areas
M34 doesn't touch (text-media editor, generation dialog, page autosave, a dialog's layout at 1280 px).

Found on the way:
- The reload after a template save overwrote edits typed while it was in flight (fixed: it keeps them).
- Switching channels reused one code editor, so undo could restore another channel's text and its accessible name
  stayed the first channel's (fixed: one editor per channel; the code editor now follows its `label`).
- m17 journey 3 demoted the instance admin to editor, which the UI ignores (fixed: it signs in as an editor account).

# M33 — Editor rules (branch `claude/sleepy-shannon-4u1kao`)

Spec: `tasks/33-m33-editor-rules/`. User decisions (2026-09-29) and binding decisions there. Templates (page, section),
dataset schemas and global sets get a `rules {}` section: validation rules, `requiredWhen`/`readOnlyWhen` states and
fills, each with scopes `edit`/`save`/`release`/`generation` and levels `hint`/`info`/`warning`/`error`; existing
attributes become built-in rules with inline level/scope overrides. One server-side rule engine for every scope.

- [x] M33.1 expression language v2 (functions, arithmetic, value results, context, v1 mode for `visibleWhen`)
- [x] M33.2 CDL `rules {}`, built-in modifiers, inheritance merge, `SF-CDL-0113`–`0119`
- [x] M33.3 rule engine + finding model (`HINT`/`INFO`, rule/scopes/messages on `ContentIssue`)
- [x] M33.4 save scope (fills, read-only enforcement, rejection incl. autosave)
- [x] M33.5 edit scope `POST /projects/{p}/rules/evaluate`
- [x] M33.6 release scope (fills in the release revision, `acceptWarnings` / `SF-DOM-0156`)
- [x] M33.7 generation scope (`holdBack`/`fail`, `SF-GEN-0121`, `SF-GEN-0122`, `RULE_REFERENCE` edge, L10N fix)
- [x] M33.8 UI (see deviations)
- [x] M33.9 spec + docs
- [ ] Benchmark: 5,000-page full build with ~10 rules per template (+10 % budget) — not run
- [ ] Manual check in the running app — not done

## Review

Verification (2026-09-29): `./gradlew test` — sf-common 19, sf-template 369, sf-domain 439, sf-generate 177, sf-api 22,
sf-app 962 (6 skipped) green except the known Linux-only `GenerationIntegrationTest.fullGenerationReachesSuccessAndPublishesOutput`
(`current` is a symlink); `spotlessCheck` and `DocsGoldenSnippetsTest` green; `npx vitest run` 126 files / 851 tests;
`npx ng build` green (only pre-existing style budget warnings). New integration suites: `SaveRuleGateIntegrationTest`,
`RuleEvaluationApiIntegrationTest` (typical page median < 50 ms), `ReleaseRuleCheckIntegrationTest`,
`GenerationRulesIntegrationTest`; the release query-count test is unchanged (no per-item reads without rules).

Deviations from the plan:
- `RULE_REFERENCE` edges are materialized statically from a CDL's `global:` reads (reference rows on save); `ref()`
  targets are editor values that are already reference rows, so a referenced asset's change rebuilds via `REFERENCE`.
  No build-fact persistence of runtime `ref` targets.
- Rule warnings at generation (`SF-GEN-0122`) make the run `PARTIAL` like every other build warning; infos don't count.
  Rule findings are run diagnostics, not a `RULE` type in the findings API.
- Plan view fields are `warningFindings` / `infoFindings` / `fills` (the existing `warnings` strings stay). Release fills
  aren't applied to pinned versions.
- ~~UI not done: `rules {}` highlighting/completion, live fills/states inside section instances, Issues-panel scope
  filter~~ — built in the follow-up below.

## Follow-up (2026-09-30, user)

- [x] Engine: section-template rules run for catalog cards (pages, sections, records, property sets; groups, list rows,
      nested catalogs) in every scope; an empty `mode empty` fill writes nothing
- [x] Live fills and field states in body sections and catalog cards (`RuleHub`, `NestedRules`)
- [x] Issues panel scope chips (Edit · Save · Release · Generation, remembered per browser)
- [x] Code editors on CodeMirror 6 (user decisions: CodeMirror; CDL and OCTL plus text-media source, record-set
      `where`, JSON; completion on Ctrl+Space only — keywords/values, editor paths, functions; expression strings
      highlighted inside CDL; squiggles + list; line numbers, brackets, folding, search; Tab indents, Esc+Tab leaves;
      live CDL validation); lazy chunk (118 kB gzipped), initial bundle 1.66 MB
- [x] Format highlighting in OCTL editors (user decisions: HTML with CSS/JS inside, Markdown, JSON, XML/SVG/RSS, CSS,
      JavaScript, YAML; channel "Highlight as" Auto + formats, any choice wins; applies to channel and record templates
      and processed text media; text media from MIME type/extension with project overrides by extension and MIME type
      on the General tab, extension before MIME, also for Auto channels; export protocol 12; completion for HTML, CSS,
      JavaScript, XML closing tags and SVG names, none for JSON/Markdown/YAML). OCTL over the format via `parseMixed`
      overlay; each grammar a lazy chunk; `PUT /projects/{key}/code-highlighting` (PROJECT_ADMIN)

---

# M32 — Complete URL registry (branch `m32-complete-url-registry`)

Spec: `tasks/32-m32-complete-url-registry/`. User decisions (2026-09-29) and binding decisions there. Every page,
paginated page, media file (per variant and language) and index-less folder gets an assign-once registry row per channel,
area and language; the registered URL drives the written file and every link. Page references and indexed folders derive
from their page; existing page-reference rows are dropped.

- [x] M32.1 model + migration (`030-url-registry-all-targets.xml`, `UrlTarget`, URL uniqueness, `ResetScope.ASSET`, change log)
- [x] M32.2 registry service (all targets, derived targets, pagination from page 1, collisions `SF-DOM-0200`/`0201`)
- [x] M32.3 generation: outputs written at registry URLs, links/nav/sitemap/canonical/link checker through the registry
- [x] M32.4 preview per locale through the registry
- [x] M32.5 root kind `URL_CHANGED`, AUTO redirects after override/reset, removal of computed rows
- [x] M32.6 export/import protocol 11 (GENERATED rows, `UrlRegistryImportMode`)
- [x] M32.7 REST API (filters, `PUT` by target, `GET …/assets/{uuid}`, `ASSET` reset, import mode)
- [x] M32.8 UI ("URLs" panel, per-asset URL sections in page/media/folder, import option, `URL_CHANGED` label)
- [x] M32.9 spec + docs
- [x] Benchmark: 5,000-page first full build (registers all 5,000 URLs) 3,532 ms vs 3,375 ms on master, fastest of two
      alternating runs each (+5 %); incremental 1,251 vs 1,331 ms
- [x] Verification: see Review
- [x] Addition (2026-09-29, user): `$CMS_REF` argument values from the template — an unquoted value is a path evaluated at
      render time (`locale=l` with a `CMS_LOCALES` item, `locale=l.code`, variables, editors, `CMS_GLOBAL`), a single
      word naming nothing stays literal; an undeclared `locale=` links the render language; preview page links follow
      `locale=`. `RefArgumentRenderTest`, `LocalizedGenerationIntegrationTest.languageLoopLinksAnotherPageInEveryLanguage`

## Review

- **Model (M32.1).** `url_registry_entry` re-keyed to `(project, channel, area, locale, target_type, target_uuid,
  variant_key, page_number)` plus unique `(project, channel, area, locale, url)`; `030` deletes every old row;
  `url_registry_change` records overrides, resets and imports for the planner.
- **Service (M32.2).** `UrlTarget`, `UrlRegistryView` (a build's in-memory area: registered URLs win, first-time URLs
  are claimed, a held URL is a collision), `resolvePage`/`resolvePageReference` for previews, target-based `override`
  with validation, `register` (JDBC batches), `deleteComputed`, `importRows`, `describe`/`indexPages` for the API.
- **Generation (M32.3).** `OutputPathResolver.withRegistry` and `MediaOutputs(…, registry)`: the plan, the renderer
  (page, media, folder links, navigation), the manifest, sitemap, redirects and link checks all see registered paths.
  URL ↔ file is lossless (`OutputPathExpander.urlForOutput` / `pathForUrl`). Claims are stored in the publishing
  transaction; registry collisions fail the build with `SF-GEN-0110` like path collisions.
- **Planner (M32.5).** `RebuildRootKind.URL_CHANGED`: pages and media whose path differs from the base manifest, plus
  folders from the change log (every pages folder after a wide reset), become roots.
- **Found on the way:** a preview without link rewriting emitted bare uids for page and media links (now registry
  URLs); `resolvePageUrl` used the directory form for any path in pretty mode, which pointed an overridden file URL at
  its directory.
- **Deviations:** build collisions fail the build (the existing `SF-GEN-0110` behavior) rather than holding back one
  output — the user's choice "fails the build" in the question; media links in a preview ignore language fallback
  sharing (a localized file is keyed by the preview's language); the migration is not tested against a database that
  already holds page-reference rows (it deletes them unconditionally before re-keying).
- **Existing tests adapted to frozen URLs:** redirect detection/output, incremental publish, released generation,
  rebuild reasons, build insight reset the page's URL after a move — without a reset nothing moves (new tests assert
  both). `GenerationIntegrationTest.fullGenerationReachesSuccessAndPublishesOutput` fails on master too in this
  environment (`current` is a directory here), unrelated to M32.

---

---

# M31 — Folder start pages (branch `m31-folder-start-pages`)

> **Correction (2026-09-29, user).** Start pages for pages-store folders were not intended and have been removed again
> — for every pages folder, `pages_root` included: no `startPage` payload, no `PATCH /folders/{uuid}`, no
> `FolderView.startPageUuid`, no `SF-DOM-0111`/`SF-GEN-0112`, no `START_PAGE` edge, no export protocol 11 (back to 10),
> no start page UI. A folder's index page is again only its page with the channel's `indexUid`. Kept from M31: the
> Navigation root is selectable (its *Entry page*), `NavigationService.indexPage` / `firstNavigablePage` prefer the
> `indexUid` page, `$CMS_REF(folder:…)` without `pages_root/`, preview folder links, moved outputs re-render navigation.
> The UID `index` is no longer reserved, so the default `indexUid` works. The rest of this file is the original plan.

Spec: `tasks/31-m31-folder-start-pages/` (written in M31.0 from the approved plan). User decisions (2026-09-28): a
folder's start page always renders at the folder's index path (only a per-page `pathOverride` wins); the channel
`indexUid` rule stays as the fallback for folders without a start page.

- [x] M31.0 epic + task files
- [x] M31.1 model + API (payload `startPage`, `updateStartPage`, PATCH, `FolderView.startPageUuid`, `START_PAGE` edge)
- [x] M31.2 output paths (both resolvers, collision, stale-pointer diagnostic)
- [x] M31.3 consumers (folder `$CMS_REF`, preview folder links, navigation, URL registry invalidation)
- [x] M31.4 planner edge, redirects, export/import protocol 11
- [x] M31.5 UI (folder start page, root reachable in Pages and Navigation, badge + menu, `nearestIndexPage`, hint)
- [x] M31.6 spec + docs
- [x] Full verification: `./gradlew spotlessCheck build test --rerun` (1,845 tests, 0 failures, 6 skipped benchmarks), `ng build`, `npx vitest run` (123 files, 847 tests), manual check in the running app


## Review

- **Model + API (M31.1).** Folder payload `startPage` (PAGES folders incl. `pages_root`), `FolderService.updateStartPage`,
  `PATCH /folders/{uuid}` with If-Match, `FolderView.startPageUuid`, `START_PAGE` reference edge (release closure,
  usages, not a delete guard), `SF-DOM-0111` when another page claims the index file.
- **Output paths (M31.2).** `pathOverride` > start page (always the folder index) > template > default; the `indexUid`
  rule only for folders without a start page; stale pointer → fallback + `SF-GEN-0112`.
- **Consumers (M31.3).** One index-page rule (`NavigationService.indexPage`) for `$CMS_REF(folder:…)`, preview folder
  links, navigation folder targets and URL registry resolution; `StartPageUrlInvalidation` on update, restore,
  discard, release and import.
- **Planner, redirects, import (M31.4).** `RebuildEdgeKind.START_PAGE`; moved outputs now also re-render navigation;
  AUTO redirects when a page moves to or from `index.html`; export protocol 11 with `START_PAGE_NOT_MERGED`.
- **UI (M31.5).** Start page picker in the folder panel, "All pages" / "All navigation" open the roots, "Start page"
  badge and "Make start page of …", redirect preselection from start pages, channels hint.
- **Docs (M31.6).** Spec §3, §5.4, §10.2, §15.2, §16.4, §17.2, §18.2/§18.3/§18.9, §19.2, §20.2, §24.5, §26.5, App. B;
  API, user and template developer guides.
- **Found on the way:** the UID `index` is reserved, so the default `indexUid` rule could never match — a default
  site had no way to get an `index.html`; the Navigation root's Entry page was unreachable in the UI;
  `$CMS_REF(folder:…)` leaked `pages_root/` into URLs and never looked for an index page; preview folder links issued a
  page share token for a folder; moved outputs never re-rendered navigation.
- **Deviations:** tasks directly under the epic (no feature folders); the set-time conflict counts index file stems,
  not `indexUid`; a preview link to a folder without an index page is empty; channel-less lookups know start pages
  only.
- **Open:** the folder panel shows the internal path `/pages_root/` for the site root (pre-existing display).

---

# M30 — Quality checks and redirects (branch `m30-quality-checks-and-redirects`)

Spec: `tasks/30-m30-quality-checks-and-redirects/`. Decisions 1–20 there are binding.
Plan deviations known up front: changelogs 026/027 are taken (M29), so quality checks use `028-quality-checks.xml`
and redirects `029-redirects.xml`. Export protocol 9 is taken (M27.8 schedules), so M30 archives are protocol **10**
(redirect registry + quality rule config); protocol-9 archives import without them.

Execution: phase A two lanes (A1 check framework in the main tree; A2 redirect registry in a worktree), phase B
parallel streams (rules ×3, redirect detection + output), phase C editor issues + UI, phase D docs + journey + full
verification.

- [x] A1 — M30.1.1 rule SPI, jsoup, `HtmlFacts`, `LinkResolver`, registry, selectors, section markers
- [x] A1 — M30.1.2 rule config per project, findings table + API, run view counts
- [x] A1 — M30.1.3 `CHECK` stage, hold-back `SF-GEN-0125`, reference events, sidecar, fallback causes, metrics
- [x] A2 — M30.4.1 redirect registry model, manual API, for-asset, export/import (protocol 10)
- [x] B — M30.2.1 link rules
- [x] B — M30.2.2 SEO rules + `nav.noIndex`
- [x] B — M30.2.3 accessibility rules
- [x] B — M30.4.2 redirect detection on build
- [x] B — M30.5.1 redirect formats per target
- [x] C — M30.3.1 draft check endpoint
- [x] C — M30.3.2 page editor Issues panel
- [x] C — M30.6.1 Quality tab
- [x] C — M30.6.2 run findings report
- [x] C — M30.6.3 Redirects tab, target formats, unpublish redirect
- [x] D — M30.7.1 spec + docs
- [ ] D — M30.7.2 `ui/e2e/m30-journeys.spec.ts` green twice — **deferred by the user (2026-09-27)**; unfinished work on branch `m30-d-journey` (WIP commit)
- [x] Benchmark: 5,000-page full build within +15 % of pre-M30 — **not met, accepted by the user (2026-09-28)** at about +20–30 % (cold JVM, 4 cores; warm ≈ +10 %), down from +53 % after the M30.1.3 performance pass
- [x] `./gradlew spotlessCheck build test --rerun` (1,795 tests, 0 failures, 6 skipped benchmarks), `ng build`, `npx vitest run` (121 files, 821 tests) — journey deferred by the user


## Review

- **Framework (M30.1).** `generate/quality/` rule SPI (page and site rules, typed params, fix hints, max severity),
  jsoup facts per HTML output, `LinkResolver`, stable selectors, section markers; per-project rule config
  (`quality_rule_config`, changelog 028, `GET/PUT /quality-rules`, revision + audit); findings table with caps and the
  findings API; the `CHECK` stage with hold-back (`SF-GEN-0125`), no-cascade, reference events (a missing link target no
  longer fails a run), `quality.json` sidecar, carried facts, the two new fallback causes, and structured `heldBack`
  run diagnostics.
- **Rules (M30.2).** The 30 catalogue rules (links, SEO, accessibility), pinned by `QualityRuleCatalogTest` against the
  registry and the spec table; `nav.noIndex` end to end (sitemap, `$CMS_META`, `CMS_META.` expression root, editor
  switch); golden fixture site (de/en/de-CH, two channels, pagination) with `expected-findings.json`.
- **Editor issues (M30.3).** Draft check endpoint (draft render with section markers, page + link rules, rate limited)
  and the page editor's Issues panel with jumps to field, section and preview element.
- **Redirects (M30.4–M30.5).** Registry (changelog 029, CRUD, for-asset, states incl. LOOP, export protocol 10),
  detection against the target's current manifest on every build, HTML stubs / `.htaccess` / `redirects.json` per
  target. Decision 18 amended by the user: anchored `RedirectMatch 301` (a directory source also matches its index file).
- **UI (M30.6).** Quality tab, Redirects tab, redirect formats in the target form, "Redirect old URL to…" in unpublish
  and delete dialogs, run findings tab with URL filters, held-back links and redirect counts.
- **Docs (M30.7.1).** Spec §10.3, §16, §18.2–§18.9, §19.4, §20.2, §24.5, §26, Appendix B; API, user, template developer
  and operator guides; checked against the merged code.
- **Found on the way:** localized pagination item links had no locale prefix (since M21); `media` editor values didn't
  expose the media's fields (the documented `altText` rendered empty) and ignored `altOverride`; the `md` filter wrote
  live `javascript:` links and `md`/`nl2br` output was escaped twice; form editors kept a stale "required" message; the
  media editor's picker never listed anything; Issues-panel focus and "Show progress" live follow. Each with a test.
- **Deviations:** changelogs 028/029 and export protocol 10 (numbers taken); spec sections §18.8/§18.9/§19.4; LOOP
  state; site files never shadow a redirect; draft checks rendered with the generation renderer; the manifest's
  `qualityFingerprint` decides the quality fallbacks (planning never reads the sidecar); initial bundle budget raised
  to 1.7/1.9 MB (user).
- **Open:** Playwright journey deferred by the user (branch `m30-d-journey`); performance budget accepted by the user
  at about +20–30 %; Liquibase 028/029 proven on H2 only; rich text `$CMS_VALUE(body | raw)$` prints the stored JSON and
  there is no server-side HTML sanitiser (needs a decision); findings name media by uid, not file name.

---

# M29 — Housekeeping jobs (branch `m29-housekeeping-jobs`)

Spec: `tasks/29-m29-housekeeping-jobs/`. Decisions 1–14 there are binding.
Plan deviations known up front: changelogs 024/025 are taken (M27.8, M28), so system jobs use
`026-system-jobs.xml` and compaction `027-revision-compaction.xml`. `LeaseClaimer` is keyed by `id`; it is
generalized to a configurable key column for `system_job.key` without changing M27 behaviour.

Execution: phase A sequential (framework), phase B three parallel streams (B1 main tree, B2/B3 worktrees, merged
back), phase C UI, phase D docs + journey + full verification.

- [x] A — M29.1.1 system job model, SPI, runner on the engine tick, metrics
- [x] A — M29.1.2 admin jobs API (+ OpenAPI / schema.d.ts)
- [x] B1 — M29.2.1 heartbeat, interrupted-run recovery, real cancel
- [x] B1 — M29.2.2 build output cleanup, published-only rollback slots, promote refusal, `retainedRunIds()`
- [x] B1 — M29.3.1 generation-run retention
- [x] B2 — M29.2.4 audit purge, refresh-token cleanup, memory eviction
- [x] B2 — M29.3.2 `media_variant`, resolver, variant backfill
- [x] B2 — M29.2.3 blob sweep (marks variants, localized files, `media_variant`)
- [x] B2 — M29.3.3 search maintenance
- [x] B3 — M29.4.1 compaction policy + schema + API
- [x] B3 — M29.4.2 compactor + job + estimate
- [x] B3 — M29.4.3 compacted reads (revisions, time travel, diff, restore, preview header)
- [x] C — M29.5.1 admin Jobs page
- [x] C — M29.5.2 compaction card + compacted notices
- [x] D — M29.6.1 spec + docs
- [x] D — M29.6.2 `ui/e2e/m29-journeys.spec.ts` green twice
- [x] `./gradlew spotlessCheck test --rerun` (1475 tests, 0 failures, 6 skipped benchmarks), `ng build`, `npx vitest run`
      (105 files, 709 tests), `m29-journeys.spec.ts` green twice


## Review

- **Framework (M29.1).** `system_job`/`system_job_run` (changelog 026), `HousekeepingJob` SPI with `JobContext`
  (dry run, counters, bounded sample, short transactions), `SettingsSpec` validation, per-job
  `sf.housekeeping.<key>.*` defaults seeded once; the runner joins the scheduler's poll as a
  `SchedulerTickParticipant` and claims with the generalized `LeaseClaimer`. `/api/v1/admin/jobs/**`, audit
  `JOB_SETTINGS_SET`/`JOB_RUN`, `sf.job.*` metrics.
- **Jobs (M29.2–M29.3).** All ten jobs of decision 7. Real cancel (checkpoints + locked final write before publish),
  heartbeat + `sf.node-id`, `SF-GEN-0504` recovery; `keep-builds` counts published builds, promote refuses
  unpublished runs (`SF-GEN-0505`), `TargetWriter.retainedRunIds()`; mark-and-sweep with `blob.last_referenced_at`
  and one locked blob write path; `media_variant` + `MediaVariantResolver`; search maintenance API on the indexer.
- **Compaction (M29.4).** Opt-in policy (changelog 027), `CompactionPlanner` + `RevisionCompactor` under the revision
  counter lock, protected releases/retained builds/pins/active builds, `original_valid_from` for exact read flags,
  compacted flags in revisions, reads, diff, restore and the `X-SF-Compacted` header.
- **UI (M29.5).** Admin Jobs list/detail (settings form, run now/dry run with polled report, history); compaction card
  with estimate and type-the-key dialog; compacted notices in spine, list, banner, diff and restore confirmation.
- **Found on the way:** refresh-token reuse detection rolled back its own family deletion; test contexts shared
  `build/out` (reruns failed); the template cache keyed versions by `(uuid, validFrom)`, which compaction makes
  ambiguous; `media_variant` rows kept compacted images' bytes forever (integration pass); phone-width overflow on
  admin tables; General settings Save enabled with nothing changed. Each with a test.
- **Deviations** are recorded in each task file (changelogs 026/027, per-job property classes,
  `sf.housekeeping.enabled`, variants merged in `SnapshotService`, no real S3 listing, dev-only
  `DevFixtureController` for back-dated journeys).

---

# M28 — Editor publishing (branch `m28-editor-publishing`)

Spec: `tasks/28-m28-editor-publishing/`. Decisions 1–14 there are binding.
Plan deviations known up front: `generation_run.comment` and its view field already exist (M27 follow-up, changelog
`023`), so the publish policy gets changelog `025-publish-policy.xml`; M28.2.2 adds only `startedBy`, the 500-char
`400` and the audit.

- [x] M28.1.1 — `PublishPermission`, `PublishPolicy` (grants/validate/effective), changelog 025, `Project.publishPolicy`
- [x] M28.1.1 — `PublishPermissionEvaluator` (membership row), `ProjectAuthorizationService.can/permissions` (403 +
      `permission` extension), `ProjectService.publishPolicy/updatePublishPolicy` (revision + audit)
- [x] M28.1.1 — `GET/PUT /publish-policy`, `POST /publish-policy/impact`, `ProjectDetail.publishPolicy/permissions`
- [x] M28.1.1 — tests: grants table, validate, can≡permitted, next-request, PUT revision/audit/no-op/archived/403,
      impact, SpEL literal scan
- [x] M28.2.1 — release/unpublish/discard via `can(RELEASE)`; `ReleasePermissionCheck` via evaluator; handler
      requirements (SCHEDULE_RELEASE + then-generate build permission); `ActionAuthority` evaluates permissions;
      foreign schedules need DEVELOPER; execution message names the permission
- [x] M28.2.2 — `GenerationAuthorization.requiredFor`; start/plan/cancel rules; `startedBy`; comment >500 → 400;
      audit START/CANCEL/PROMOTE; idempotency key scoped by project+user; admin audit labels
- [x] M28.2.3 — `PublishPermissionMatrixTest`
- [x] M28.3.1 — `ProjectPermissionsStore`, migrate ad-hoc role checks, 403 `permission` handling, visibility refresh
- [x] M28.3.2 — "Publishing by editors" card with impact dialog
- [x] M28.3.3 — gated generation screen (dialog restrictions, scope, cancel/promote, startedBy), release surfaces,
      schedules, Build now, empty state
- [x] M28.4.1 — spec + docs
- [x] M28.4.2 — `ui/e2e/m28-journeys.spec.ts` green twice; defects fixed with tests
- [x] `./gradlew test --rerun` (1365 tests, 0 failures, 6 skipped benchmarks), `ng build`, `npx vitest run` (96 files, 645 tests)


## Review

- **Backend (M28.1–M28.2).** One rule for everything: `PublishRequirements.missing(role, policy)` over
  `PublishPolicy.grants`, evaluated from the token (`ProjectAuthorizationService.can/satisfies`) and from the stored
  membership (`PublishPermissionEvaluator`, used by the scheduler, the schedules API and the release service).
  `GenerationAuthorization` decides what a generation request needs; release handlers state SCHEDULE_RELEASE plus the
  "then generate" build permission. Denials carry `permission`. Tests: policy unit table, publish-policy API (incl. the
  next-request check with a still-valid token and the SpEL literal scan), release/schedule and generation integration,
  and the matrix walk (494 checks; negative control documented).
- **UI (M28.3).** `ProjectPermissionsStore` replaces every ad-hoc role check and M27's `ReleasePermissionsStore`; the
  "Publishing by editors" card with impact dialog; gated generation screen (restricted dialog, scope, own-run cancel,
  started-by), release bar/Changes/schedules follow the server rules; "Build now" after a release.
- **Found on the way:** toasts were never rendered (added `ToastHostComponent`); the journey found the navigation
  refresh dropping updates inside its throttle window (now coalesced). Both with specs.
- **Deviations** (recorded in `04-docs-e2e/001-docs-and-spec.md`): changelog 025; comment >500 truncated (M27 rule);
  LOCKED accounts keep permissions; policy not versioned for time travel; a foreign target id is 403 FULL_BUILD, not 404;
  no audit label table exists in the UI; the dialog never had "pin revision"; the publish policy is not part of export
  archives (follow-up candidate).

---

# M27.8 — Schedules in archives, protocol 9 (branch `m27-8-schedule-export`)

Spec: `tasks/27-m27-release-and-scheduling/08-schedule-export/`. Decisions 1–9 there (with the user, 2026-09-26).

- [x] M27.8.1 — changelog 024 (schedule + target uuid), entity/repo/views
- [x] M27.8.1 — `ReleaseServiceImpl.plan` `noRollbackFor`; `ScheduleService.importAction` (validates a detached copy, returns refusals)
- [x] M27.8.1 — export: `schedules/<uuid>.json`, `includeSchedules`, target uuid in settings
- [x] M27.8.1 — import: settings by uuid, `importSchedules`, analysis warnings, result counts; API + OpenAPI
- [x] M27.8.1 — `ScheduleExportImportIntegrationTest` (7 tests covering T1–T14; protocol-8 archive rewritten in the test), existing tests updated
- [x] M27.8.2 — export checkbox, import option, warnings, vitest
- [x] M27.8.3 — docs
- [x] `./gradlew build test --rerun` (1338 tests, 0 failures, 6 skipped benchmarks), `npm run build`,
      `npx vitest run` (90 files, 603 tests); manual check on the dev stack

## Review

- **Backend.** `ScheduleArchive` (new, package-private) carries all schedule logic; the export/import service only
  wires it in. `ScheduleService.importAction` validates each schedule like a create (as its owner) on a detached copy
  and returns refusals instead of throwing. `ReleaseServiceImpl.plan` no longer dooms a caller's transaction when it
  refuses (`noRollbackFor`): without it one invalid schedule rolled back the whole import (two tests fail without it).
  Changelog `024` adds `uuid` to `scheduled_action` and `generation_target` (PostgreSQL backfill reviewed, not
  testable here: no PostgreSQL on this machine).
- **UI.** Export: "Include schedules". Import: a "Schedules" choice when the archive has any, schedule warnings
  without the asset provenance badge, and the commit-time outcomes under the result.
- **Manual check** (clean dev DB, Playwright script): a project with a pinned release + then-generate and a recurring
  generation exported with targets and schedules; imported into a second project — both schedules pending, the target
  resolved by uuid, pin drift 0, the recurring one at its next 03:00 Berlin slot; re-import lists "Replaces schedule
  #…" for both, and "Don't import schedules" drops those warnings. Two polish fixes came out of the screenshots:
  readable labels ("Release at 2026-09-28 11:39 UTC …") and no "explicit" badge on schedule warnings.
- **Deviation:** the protocol-8 case is an archive rewritten in the test, not a frozen fixture directory.


---

# Generation run comment (follow-up to M27, branch `m27-release-and-scheduling`)

A run's comment was passed to generation but never stored. This affected manual runs (the dialog's "Optional note
for this run") and the notes schedules give their runs (M27 deviation, decision 21).

- [x] `generation_run.comment` (changelog `023`, `VARCHAR(500)`). `GenerationService.start` stores the trimmed
      comment; blank means none, and a longer one is cut to 500 characters ending in "…", like a revision comment.
- [x] `GenerationRunView.comment`; OpenAPI + `schema.d.ts`; the Generation runs table shows it under the mode.
- [x] Tests:
  - `BuildInsightApiTest.aRunKeepsTheCommentItWasStartedWith` covers start, read, history, blank and too long.
  - `ScheduledActionsIntegrationTest` covers "Scheduled generation #n: nightly" and "After scheduled release #n".
  - `generation.component.spec.ts`.
- [x] Spec §18.5, `docs/api.md`, and the M27 deviation note marked resolved.
- [x] `./gradlew build test --rerun` (1329 tests, 0 failures, 6 skipped benchmarks), `npm run build`,
      `npx vitest run` (90 files, 598 tests)


---

# M27.7 — Docs and journey (branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/07-docs-e2e/`. 7.1 (docs, agent) and 7.2 (journey, me) in parallel.

- [x] M27.7.1 — spec §2.2, §5, §7, §10.4/5, §11, §16.4, §17, §18.1/2, §19, Scheduler section, §20.2, §23/§24,
      §26.2/4/5, Appendix B/C; `docs/api.md`, `user-guide.md`, `template-developer-guide.md`, `administration.md`,
      `architecture.md`, `infra/README.md`, `release-readiness.md` §4; deviations recorded
- [x] M27.7.2 — `ui/e2e/m27-journeys.spec.ts`, the 10 steps, self-seeding, 1280 px assertions
- [x] Journey green twice on a clean dev stack (scheduler poll 2 s); defects fixed with a test each
- [x] `./gradlew build test --rerun` (1328 tests, 0 failures, 6 skipped benchmarks), `npm run build`,
      `npx vitest run` (89 files, 597 tests)


## Review

- **Docs (7.1)**, written by a parallel agent against the code:
  - Spec: new subsections §5.5 (release state), §11.6 (localized media) and §18.7 (scheduler). No existing number
    moved.
  - Updated §2.2, §7, §10.4/5, §16.4, §17–§19, §20.2, §21, §23/§24, §26.2–§26.5, §27, and Appendix B/C.
  - API reference, user guide, template developer guide, administration, architecture, infra README and release
    notes.
  - Every deviation from the epic decisions, with its reason, is in `07-docs-e2e/001-docs-and-spec.md`.
  - Correction from checking the code: `SF-GEN-0221` covers links only. A value read from an unreleased asset
    renders empty with `SF-TPL-0112`, like a deleted one.
- **Journey (7.2)**:
  - All ten steps pass through the UI, including builds, localized media on disk, a pinned scheduled release with
    then-generate, a cron schedule, deletion, export/import and the `EDITOR` view.
  - Green twice in a row on a clean stack.
  - Several failed runs were script errors: the Windows `current` pointer file, server-normalized images, a step
    that didn't reopen the editor after a build, and the media drawer left open.
- **Defects found and fixed, each with a test:**
  - `CHANGED` over an empty diff, from `null` vs absent fields in the locale projection (`LocaleProjectionTest`).
  - Drift shown after a schedule ran (`schedules.component.spec.ts`).
  - One-off times inside a DST gap resolved differently from cron slots (`zoned-time.util.spec.ts`; spec §18.7
    states the rule).


---

# M27.6 — UI: release status, release bar, Changes, preview toggle, localized media, Schedules (branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/06-ui/`. Order 6.1 → 6.5 → 6.2; 6.3 and 6.4 in parallel (separate agents,
separate feature folders).

Design (beyond the task text):
- New `features/release/`: `ReleaseService` (plan/release/unpublish/discard + changes API), `release-status.util`
  (labels, status for the editing locale with `""` fallback, tooltip text), `ReleasePermissionsStore` (`canRelease()`:
  role ≥ `DEVELOPER` and not read-only — the one place M28 swaps), `ReleaseEventsStore` (a counter bumped after every
  release/unpublish/discard/schedule action; lists, the nav-rail count and release bars refresh on it — no polling).
- `sf-release-badge` takes the DTO's `release` + `scheduled` blocks and reads the editing locale itself.
- `sf-release-bar` loads its own state with `GET /assets/{uuid}` (the generic detail carries `release`/`scheduled` for
  every releasable type) and re-loads on `refreshKey` (the editor's saved revision) and on release events — one data
  source, never computed client-side, and one integration line per editor.
- Dialogs follow the `design/_dialog-shell` pattern (scrim + panel, Escape closes).
- Routes stay eager like every other project route (decision of 2026-09-16 in `app.routes.ts`), not lazy.

- [x] API client: releases, changes, schedules, preview `view`, media localized/files/text locale
- [x] M27.6.1 — badge, release bar, release/unpublish/discard dialogs, permissions store; bar in every releasable
      editor; badges in pages tree/list, content, globals, media, navigation; delete confirmation texts
- [x] M27.6.5 — schedule dialog (time zones, cron presets, preview times, pin/missed/then-generate, dependencies),
      Schedules page (filters, actions, history drawer), bar "Schedule…" + pending-schedule line, nav-rail entry
- [x] M27.6.2 — Changes view (URL filters as chips, paging, sort, diff panel, multi-select actions, keyboard), nav-rail
      count badge
- [x] M27.6.3 — preview Draft/Published toggle, not-published empty state, status line, share view (agent)
- [x] M27.6.4 — localized media drawer, files section, text locale, library marker/thumbnail (agent)
- [x] Backend additions the UI needed: `GET /media/{uuid}` (per-language files resolved server-side),
      `ownerUserId` on `scheduled` refs; OpenAPI + `schema.d.ts` regenerated
- [x] `npm run build`, `npx vitest run` (89 files, 596 tests); `./gradlew build test --rerun` (1327 tests, 0 failures,
      6 skipped benchmarks); manual check in the running app (dev stack on scratch ports)


## Review

- **Delivered as specified**, with these design choices:
  - One data source for statuses: the DTO `release` blocks. The release bar reads its asset itself
    (`GET /assets/{uuid}`) and again after every save and every release action. Lists re-read on release events.
    A row shown elsewhere is patched right away with the status the bar just read (`ReleaseEventsStore.observed`),
    so the tree shows "Changed" as soon as the editor saved.
  - Permissions sit in `ReleasePermissionsStore` (one computed per operation, `DEVELOPER` + not read-only) so that
    M28 changes a single class.
  - Routes `changes` and `schedules` are eager, like every other project route (the 2026-09-16 single-bundle
    decision), not lazy as the task text says.
- **Backend additions the UI needed** (instead of copying server logic into the UI):
  - `GET /media/{uuid}` returns `MediaView` with `localeFiles`. The media agent had first re-implemented
    `MediaFiles.fileFor` in TypeScript for drawers opened from list rows; that copy is gone.
  - `ownerUserId` on `scheduled` refs, so the bar can say "Release scheduled for … by Ana" without one request per
    schedule.
- **Fixed on the way (pre-existing, found by the manual check): history rewritten by page PATCH and section
  edits.** `BodyService` edited the stored version's payload in place. Content merge-patch and section add, reorder,
  delete and move therefore rewrote the *previous* version's row at flush. A released page that was edited through
  these endpoints stayed `PUBLISHED`, and the next build would have published the unreleased edit. Fixed at the root
  (deep copy). `PagePayloadHistoryIntegrationTest` fails on the old code and passes now. See `lessons.md`.
- Also fixed: the media library's thumbnail cache never refreshed after a file was replaced. It is keyed by
  revision now, which matters more now that a language can get its own file.
- **Manual check** (scratch stack 8082/4301, Playwright at 1280 px, screenshots checked):
  - Release: NEW → release dialog → Published, with the tree badge and the nav-rail count updated.
  - Per language: an EN edit makes EN Changed while DE stays Published. Preview Draft shows the edit, Published
    shows the old text, per language. Discard restores the text in the editor and the preview.
  - Delete: deleting a published page makes it Deletion pending. Releasing the deletion from the Changes view
    (keyboard selection) removes it.
  - Schedule: a release 2 minutes ahead with then-generate ran on time ("4 s late"), and the page became
    Published. The history links revision r23, and generation run #1 opens expanded.
  - Localized media: toggle, EN upload, the thumbnail follows the editing language, EN released alone. Turning
    localization off lists the file to discard first.
  - Preview "Not published in Deutsch" and the share view choice.
  - 220 changes: 5 pages; paging, locale and search filters in the URL; select all on the page.


---

# M27.1.4 — Release performance for large selections (branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/01-release-model/004-release-performance-large-selections.md`. Backend.

- [x] `ReleaseBenchmark` (`SF_PERF`): Changes list, plan and release timed separately with statement/flush/load counts
- [x] Baseline, 5,000 pages × 2 locales = 10,101 items: release 328.7 s / 40,224 statements, plan 2.5 s / 40,222
- [x] Fix: bulk `resolve`, per-call completeness checker (`PageContentValidation.Session`), layered dependency walk,
      batched pointer close
- [x] After: release 1.8 s (reads ~44 + one insert per pointer), plan 1.0 s / 40 statements
- [x] `ReleaseQueryCountIntegrationTest` (bounded reads; refusal writes nothing), fails on the old code
- [x] Full `./gradlew build` (`test --rerun`)


## Review

- Cause confirmed by measurement: ~4 queries per item, and in the read-write release transaction each query
  auto-flushed with a dirty check of everything loaded so far — quadratic. Plan (read-only) ran the same queries in
  2.5 s. Fixed by removing the per-item queries; no flush-mode change.
- Pointer inserts stay one statement each (`IDENTITY` ids); the whole 10,101-item release, inserts included, takes 1.8 s.


---

# M27 feature 5 — Export/import protocol 8 (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/05-export-import/`. Order 5.1 (backend) → 5.2 (UI).

Design (beyond the task text):
- `ExportedAsset` gains `release: [ExportedRelease]` (open pointers) and `draftDeleted`. `ExportedRelease` =
  `{locale, state: DRAFT_EQUALS | PAYLOAD | UNPUBLISHED, uid?}` plus, for `PAYLOAD`, the released version's payload, display name,
  parent folder uuid, folder path, template uuid, MIME type and size. `uid` only when the released uid differs from
  the asset's. `DELETION_PENDING` assets (deleted draft, open pointer) are exported with the tombstone as the draft.
- Media blobs: export/import walk `localeFiles` and released payloads too.
- Import `KEEP`: every distinct released `PAYLOAD` becomes one extra version of the asset *closed in the import
  revision* (`validFrom = validTo = R`: never the version valid at any revision, so "at most one valid version" holds
  and nothing but the pointer reads it); pointers open in the import revision (one revision, hazard note). Released
  payloads get the same remap + `origin` as the draft, so the per-locale projections — and statuses — match the
  source. Released folder paths are rebased from archive paths to target paths (longest imported-folder prefix).
- Locale keys: an entry is kept when its key is one the asset has in the target (effective config: the target's
  locales, or the archive's when the import brings them); `""` → every target locale; anything else is
  `RELEASE_LOCALE_MISSING` (warning, one per asset, pointer dropped).
- An overwritten asset: `KEEP` replaces the target's open pointers with the archive's (import wins); `DRAFT` leaves
  them alone (the live site is untouched by a draft import). Skipped implicit assets: untouched. `DRAFT` skips
  deletion-pending assets (a tombstone is not a draft).
- Analysis: `ConflictReport` gains `releaseState` (archive carries it) and `releaseMode` (the effective default);
  protocol ≤ 7 adds an `INFO` entry `ARCHIVE_WITHOUT_RELEASE_STATE` (new severity `INFO`).
- Import is a restore, not a release: no completeness gate.

- [x] M27.5.1 — protocol 8 export/import, `releaseMode` option (API param), analysis fields, `RELEASE_LOCALE_MISSING`,
      protocol-7 fixture; tests: round trip (statuses + identical full build), `DRAFT`, protocol 7, missing locale
- [x] M27.5.2 — import dialog: release-state radios / protocol ≤ 7 note, `releaseMode` sent; vitest
- [x] OpenAPI + `schema.d.ts`; full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`;
      manual check in the running app


## Review

- As planned, plus two additions found by the tests:
  - **`UNPUBLISHED` entries.** Open pointers can't tell `UNPUBLISHED` from `NEW`. The round-trip test failed on this, so
    the archive also lists locale keys that were released once. An import writes each one as a pointer opened and
    closed in the import revision (history only).
  - **Reference edges of imported released versions.** `asset_reference` has one edge set per asset and revision. An
    imported released version therefore got its draft's edges, so the incremental planner missed pages whose released
    version alone referenced a newly released asset. `RebuildExpansion` now extracts those versions' edges from their
    payloads. A test proved the gap first (empty plan).
- Decisions to confirm: `KEEP` over an existing asset replaces the target's release state with the archive's (import
  wins); `DRAFT` leaves it alone and skips deletion-pending assets. An import is a restore, so there is no
  completeness gate. Other missing locales are a warning.
- Changed after review (user): a `""` (all languages) pointer releases only the target languages the archive has;
  the manifest now lists the archive's languages (`locales`). An archive without languages counts as the target's
  default language: its pointers release that language only.
- **Fixed on the way (pre-existing, M27.4):** `ScheduledActionsIntegrationTest.busyProject` failed 2 of 3 runs, on
  master too. In its last tick the one-off and the coalesced hourly generation are both due. A project runs one
  generation at a time (epic decision 27), so whichever starts second waits, and closing the engine then recorded
  `SKIPPED`. The product behaves as decided, but the test assumed both start in one tick. It now ticks until both have
  started, awaiting each run in between. It passed 5 of 5 runs after the fix.
- Verification: `./gradlew build test --rerun` green: 1321 tests, 0 failures, 5 skipped benchmarks. `ui` `npx vitest run`: 79 files, 540 tests. Manual
  check on a scratch dev stack (8082/4301): with a protocol-8 archive the radios show `KEEP` as default. Switching
  re-analyzes with `DRAFT`. Committing `KEEP` kept 2 releases, and only the never-released page appears in Changes.
  With the protocol-7 fixture the UI shows the note and no radios, and the import succeeds.


---

# M27 feature 4 — Scheduler (implementation, branch `m27-release-and-scheduling`)

Spec: `tasks/27-m27-release-and-scheduling/04-scheduler/`. Backend only; order 4.1 → 4.2/4.3 → 4.4.

Design (beyond the task text):
- `sf-domain/scheduler`: tables + entities, `LeaseClaimer` (reusable conditional-update claim/extend, JDBC),
  `ScheduleTiming` (cron normalize, zone, DST via `CronExpression` on `ZonedDateTime`), SPI
  (`ScheduledActionHandler`, `ActionSpec`, `ActionRequirements`, `ExecutionContext`, `ExecutionResult`),
  `ActionAuthority` (DB-read owner/caller check of a handler's requirements — API and engine share it),
  `SchedulerEngine` (plain class, `tick()` returns a future; tests build their own engines with a mutable clock and
  node id), `ScheduleService` (API operations), side table `scheduled_action_asset` (the assets an action touches:
  `scheduled` on DTOs and the `assetUuid` filter in one indexed query).
- A handler that meets a busy project returns `WAITING`: the execution stays open with its progress in `detail`,
  the action returns to `PENDING` with `next_run_at` unchanged (due → retried every tick; later recurring slots
  coalesce). A re-claim resumes the open execution; release/run starts write their progress in the same
  transaction as the release revision / run row, so a retry never repeats a finished step.
- `RELEASE`/`UNPUBLISH` handlers in `sf-domain` (use `ReleaseService`), then-generate through the port
  `ScheduledGenerationStarter` implemented in `sf-generate` next to the `GENERATION`/`RECURRING_GENERATION` handlers.

- [x] M27.4.1 — `022-scheduler.xml`, entities/repositories, `SchedulerProperties`, `LeaseClaimer`,
      `ScheduleTiming`, SPI, `ActionAuthority`, `SchedulerEngine` (claim, missed policy, owner re-check, archived,
      audit, metrics, lease extension); tests: two engines × 50 actions, crashed lease, missed policies, DST, owner
      lost, archived
- [x] M27.4.2 — `RELEASE` (pin/latest, per-item skip, one revision, progress) / `UNPUBLISH` handlers, then-generate
      with busy wait, `ScheduleDrift`, re-pin; tests
- [x] M27.4.3 — `GENERATION` / `RECURRING_GENERATION` handlers (validation `0161`, owner start, idempotency key,
      busy wait/skip/coalesce, target gone `0162`); tests
- [x] M27.4.4 — `ScheduleController` + DTOs, `scheduled` on asset DTOs and Changes rows, audit, walk test,
      problems `0164`–`0168`, OpenAPI + `schema.d.ts`; MockMvc tests
- [x] Full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`


## Review

- Backend as planned. Design points beyond the task text are in each task's implementation notes. The engine is a
  plain class tests run with their own node ids and clocks. Handlers report `WAITING` for a busy project, and the
  execution stays open. Progress is checkpointed in the transaction of each step. The side table
  `scheduled_action_asset` answers `scheduled` in one query. The then-generate port lives in `sf-domain` and is
  implemented in `sf-generate`. Permissions come only from `handler.requirements`, for the API caller and for the
  owner at execution.
- Fixed or aligned on the way: a `LOCKED` instance admin may release (same rule as the owner check), and a `@Version`
  conflict at commit is `409 SF-API-0409` instead of a 500. `ReleasePermissions.canSchedule` was removed (unused).
  Asset DTOs' `scheduled` is now `ScheduledRefView[]`.
- `./gradlew build test --rerun`: 1312 tests, 0 failures (5 skipped benchmarks). New suites: `ScheduleTimingTest` (4),
  `SchedulerEngineIntegrationTest` (8), `ScheduledActionsIntegrationTest` (9), `ScheduleApiTest` (6) and
  `ProblemExceptionHandlerTest` (1). `ui` `npm run build` and `npx vitest run` (79 files, 536 tests) are green after
  regenerating `schema.d.ts`.


---

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
- [x] OpenAPI + `schema.d.ts`; full `./gradlew build` (`test --rerun`), `ui` `npm run build` + `npx vitest run`


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
- `./gradlew build test --rerun`: 1283 tests, 0 failures (5 skipped benchmarks); late-edited classes re-run green;
  `ui` `ng build` (in the Gradle build) and `npx vitest run` (79 files, 536 tests) green.

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
