---
id: M8.3.1
status: done
depends: [M8.1.6, M8.2.5]
epic: m8-navigation-rewrite
feature: verification
area: qa
---

# M8.3.1 — End-to-end journey: navigation store + URL registry

## Context

Proves the epic's exit criteria as one coherent scenario rather than scattered unit
tests, mirroring M5's journey-4 approach (`ui/e2e/m5-journeys.spec.ts`).

## Goals

- Playwright (or the project's established e2e tool) journey, e.g.
  `ui/e2e/m8-journeys.spec.ts`:
  1. Create a navigation folder tree: root → "Products" folder (no `startNode`) →
     `PageReference` targeting a page-store folder with 3 pages, plus a top-level
     `PageReference` targeting a single page.
  2. Set "Products" folder's `startNode` to the folder-targeted reference.
  3. Add `$CMS_NAVIGATION(nav:root)$` to a page template channel.
  4. Generate the project (HTML channel); assert the rendered nav has correct hrefs and
     "Products" links to the first page of its target folder.
  5. Rename the target page's `displayName`/slug; regenerate; assert the URL is
     unchanged (stability).
  6. Reset the registry for that channel via the settings UI (`M8.2.5`); regenerate;
     assert the URL now reflects the renamed page.
  7. Open the live preview for a different page and assert its `PREVIEW`-area nav URLs
     are independent of the `GENERATED`-area ones from step 4/6.
- Also add/port golden-file coverage for the `navigation` OCTL instruction analogous to
  the retired nav golden test from M5 (active/trail/recursion), now against the new
  tree shape.

## Acceptance criteria

- [x] The e2e journey passes locally against a running dev stack. **Substituted**: no
      seeded demo backend / interactive browser was available in this environment (same
      constraint M5/M6/M7 document for their own Playwright journeys — `SF_RUN_E2E=1`
      gated, never actually run here either). `ui/e2e/m8-journeys.spec.ts` was written
      anyway, documenting the intended UI flow the same way the m5/m6/m7 specs do, but the
      actual proof for this criterion is `M8NavigationJourneyIntegrationTest`
      (`server/sf-app`), a real `@SpringBootTest` exercising the identical 7-step scenario
      end-to-end via real service calls through a real generation pipeline (not mocked) —
      verified green, see Implementation record.
- [x] Golden-file suite for `navigation` rendering is green in `./gradlew build`.
- [x] All M8 exit criteria checkboxes in `08-m8-navigation-rewrite/README.md` can be
      ticked off with this journey/suite as evidence.

## Out of scope

- None — this is the epic's closing verification task.

## Notes / hazards

- If the project's e2e suite is gated behind an env flag (`SF_RUN_E2E=1`, as M5's was)
  and blocked on demo seed data, follow the same convention rather than inventing a new
  gating mechanism.

## Implementation record (M8.3.1, done — milestone closing task)

**`M8NavigationJourneyIntegrationTest`** (`server/sf-app/src/test/java/com/acme/staticforge/`,
one `@SpringBootTest` method, `fullNavigationAndUrlRegistryJourney`) runs the exact 7-step
scenario from this task's Goals against real services (no mocks) through a real generation
run:
1. Page store: a "Catalog" folder with 3 pages (`Page A/B/C` — alphabetically-first is the
   deterministic first-navigable-page) plus a standalone "Contact Page". (Pages/Media have no
   eager root folder, unlike Navigation — `null` parentFolderUuid is the implicit root, same
   as `CreatePageCommand`'s own convention; documented in the test's own comments so it isn't
   mistaken for a bug by a future reader.)
2. Navigation store: root → "Products" folder (initially no `startNode`) → a `FOLDER`-kind
   `PageReference` targeting the Catalog folder, plus a top-level `PAGE`-kind `PageReference`
   targeting Contact Page directly.
3. A page template's `html` channel source is `$CMS_NAVIGATION(nav:<navRootUid>)$`, output to
   `index.html`.
4. First full HTML generation: asserts Contact's href, that "Products" (grouping-only, no
   `startNode` yet) has no href, and that the Catalog reference's href points at "Page A"
   (first navigable page, alphabetical/`nav.position` order).
5. Sets "Products"' `startNode` to the Catalog reference; regenerates; asserts "Products"
   now shares Catalog's href (the entry-point delegation working end-to-end).
6. Renames "Page A" → "Page A Renamed" (its output path is `{folder}{displayNameSlug}.{ext}`,
   so a rename *would* change the URL if recomputed); regenerates; asserts the `GENERATED`-area
   href is **byte-identical** to before the rename (stability) and cross-checks
   `UrlRegistryService.resolve(...)` directly returns the same cached value.
7. Resets the registry for the `html` channel via `UrlRegistryService.reset(projectId,
   ResetScope.channel("html"), ctx)` (the exact call path the M8.2.5 settings UI's
   "reset channel" button makes); regenerates; asserts the href now reflects the rename
   (reassignment proven).
8. Renders a live preview of a different page and asserts its `PREVIEW`-area href for the
   Catalog reference is independent of (and, in this run, different from) the `GENERATED`-area
   one — proven by first asserting they happen to match pre-reset, then reconfiguring the
   preview-only page's own template source to a distinguishable value and re-rendering, showing
   the areas never leak into each other's cache entries.

**Golden-file coverage**: added `server/sf-domain/src/test/resources/navigation/render/04-deep-recursion/`
(a 4-level-deep nested tree, `active.txt` marking a leaf as current so every ancestor gets
`trail`) to `NavigationHtmlGoldenTest`'s directory-driven corpus (`M8.1.4`) — the existing
3 fixtures (flat, nested, null-startNode-grouping) didn't exercise more than 2 levels of
`renderNavigationRecurse`; this closes that gap. No new test class was needed, the existing
harness auto-discovers new subdirectories.

**e2e Playwright spec**: `ui/e2e/m8-journeys.spec.ts` was written, following the exact
m5/m6/m7 precedent (`SF_RUN_E2E=1`-gated `test.skip`, documents intended UI flow: build the
tree via the M8.1.6 navigation UI, generate, edit, reset via the M8.2.5 settings UI). It was
**not run** — this environment has no seeded demo backend or interactive browser, the same
blocker `ui/e2e/README.md` already documents for m5/m6/m7's own specs. `ui/e2e/README.md`
was updated with a row for it and an explicit note that `M8NavigationJourneyIntegrationTest`
is the actual evidence for this milestone's e2e acceptance criterion.

**A note on test flakiness encountered while verifying this task**: `GenerationIntegrationTest`,
`NavigationUrlRegistryIntegrationTest`, and this task's own new
`M8NavigationJourneyIntegrationTest` all drive a real generation run and poll for a terminal
state with a 60-second timeout. Under heavy concurrent machine load (many `./gradlew`
processes across this milestone's multiple parallel agent worktrees), one or another of these
occasionally hits that timeout — confirmed on every occurrence, across several verification
passes, to be pure load-induced flakiness and not a real regression: each failing test passes
cleanly in isolation (~30–60s instead of timing out at 60s), and a subsequent full `./gradlew
build` run with less concurrent load goes green. This is a pre-existing test-suite
characteristic (already present before M8, e.g. `GenerationIntegrationTest`), not something
this milestone introduced or needs to fix — noted here as the final entry in this pattern's
paper trail across the milestone's task files (`M8.2.3`'s Notes has an earlier instance of
this same observation).

**Final verification**: `./gradlew build` (all modules, all tests) green; `cd ui && npm run
build` green. Epic-level exit criteria updated in `tasks/08-m8-navigation-rewrite/README.md`
(see that file's own final state) — every checkbox is now genuinely satisfied and ticked; none
were left unticked.
