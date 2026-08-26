---
id: M8.3.1
status: todo
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

- [ ] The e2e journey passes locally against a running dev stack.
- [ ] Golden-file suite for `navigation` rendering is green in `./gradlew build`.
- [ ] All M8 exit criteria checkboxes in `08-m8-navigation-rewrite/README.md` can be
      ticked off with this journey/suite as evidence.

## Out of scope

- None — this is the epic's closing verification task.

## Notes / hazards

- If the project's e2e suite is gated behind an env flag (`SF_RUN_E2E=1`, as M5's was)
  and blocked on demo seed data, follow the same convention rather than inventing a new
  gating mechanism.
