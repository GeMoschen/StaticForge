---
id: M35.1
status: done
depends: []
epic: m35-ui-ux-overhaul
feature: groundwork
area: fullstack
---

# M35.1 — Functional bugs from the UX run

## Context

Found by the screenshot run of 2026-09-30 (seeded project, dev backend). None of these is verified at code level yet.
User decision 23: fix them before the redesign builds on them.

## Goals

Reproduce each bug, find the root cause, fix it and add a regression test. If a report turns out to be expected
behaviour, write down why under Notes.

1. **Revision diff prints `[object Object]`** for language-dependent values (Settings → Revisions → diff; time travel).
   Section instances are labelled by template UUID and "#1 #1" instead of the section template's name.
2. **Opening a record creates a revision.** Just opening a record produced an "update record" revision and moved it to
   the top of Changes. This is suspected to be the record editor's autosave or a rule fill firing on load.
3. **The page meta popover doesn't close.** Escape doesn't close it, and it stays open across navigation to another
   page and under modals.
4. **Time travel leaks.** At an older revision the pages tree still shows items added later. The "viewing a past
   revision" toast follows the user to the dashboard. Clicking a spine tick from the editor jumps to Settings →
   Revisions. Fix the stale tree and the leaking toast; the spine itself goes in M35.12.
5. **The media detail thumbnail collapses** to a ~10 px strip. Alt text sent with the upload (`altText` multipart field)
   doesn't show in the drawer.
6. **The templates tree shows two selections.** The "Page Templates" folder stays highlighted whatever is selected.
7. **Release status is inconsistent.**
   - A page edited through the API after its release still shows *Published*, with Release disabled.
   - Editing only the EN intro of a page marked both DE and EN as changed.
8. **NG0600 "Writing to signals is not allowed in a computed/effect"** (3×) was seen around the release dialogs, the
   media drawer, navigation, generation details and an empty project. Find every source.
9. **Globals detail has no padding.** Inputs run flush against the tree divider and the window edge.
10. **A multi-language setup allows a build that is certain to fail.** The template output path lacks `{locale}` while
    the project has two languages. The failure then shows as 5 identical `SF-GEN-0111` lines naming page UUIDs.
    - Add a template-save / language-setup **warning**.
    - Make the run's finding name the page and link to it.
11. **Changes page height is miscalculated.** A full-page capture was 2898 px tall with the table in an inner scroll
    box showing about 8 rows.
12. **URL registry shows "No URLs registered" after builds ran.** Verify whether the builds had released pages; if not,
    this is expected behaviour — write that down.
13. **Enabled with nothing to do.**
    - Settings → Media *Save* and the media drawer *Save metadata* are enabled with nothing dirty.
    - *New generation* is enabled in a project without targets.
    - The new generation dialog's Target select starts blank instead of the default target.

## Acceptance criteria

- [x] Every item is fixed with a regression test (vitest or backend test), or documented as expected behaviour (see Results).
- [x] No NG0600 in the vitest run. **Not** walked in a running app (see Results, item 8).
- [x] `./gradlew test` green except `ReleaseApiTest.searchFacet` (fails the same way on untouched HEAD); `npx vitest run` 142 files / 937 tests green; `npx ng build` green (only the two pre-existing NG8102 warnings).

## Out of scope

- Visual restyling (later tasks). Fix only what is broken.

## Notes / hazards

- To reproduce, seed a project with 2 languages, 2 targets, pages in folders, a section template, media, navigation,
  global sets and datasets with records (see the M16–M19 journeys for seeding code).

## Results (2026-09-30)

| # | Outcome |
|---|---|
| 1 | Fixed. Whole language-dependent values are diffed per language (`<path>.values.<locale>`); sections show the template display name (fallback uid) and their position once. |
| 2 | Fixed. `AutosaveService.flush()` wrote unconditionally and the record editor flushes on destroy; it now writes only after a real edit. |
| 3 | Fixed. The popover closes on Escape, outside mousedown and page change. |
| 4 | Fixed in part. The time-travel state now ends when leaving the project, and the pages tree hides items created after the viewed revision. **Open:** items *deleted* after that revision are still missing (needs a `?revision=` on the folder tree and page list). The spine tick jump stays until M35.12. |
| 5 | Backend stores and returns `altText` (test added); drawer thumbnail collapse fixed in CSS; the drawer kept the previous file's alt text when another file was picked — fixed. |
| 6 | Fixed. The folder highlight is cleared while a template is open. |
| 7 | **Not reproduced on the server** (edit after release marks the changed languages; EN-only edit flags only EN unless DE falls back to EN). Likely causes: the UI keeping a stale release block, and the first UI save adding `''`/`[]` for fields missing on an API-seeded page. Left as is: treating empty as missing would change what release and builds consider changed. |
| 8 | Two sources fixed (`ProjectContextStore.loadFor` called from effects; an effect in `ConflictDrawerComponent`); no others found in a static audit of all effects. Not confirmed in a running app. |
| 9 | Fixed (padding). |
| 10 | Template detail carries `warnings` (`SF-GEN-0112`, field `outputPath:<channel>`), shown at the top of the channel panel. The build finding `SF-GEN-0111` is one line per path expression and names pages (uid, display name, path). **Not done:** no link to the page (run diagnostics have no structured page reference) and no warning on the language-setup save. |
| 11 | Fixed in CSS (`position: relative` on the table wrap). Cause inferred from code, not seen in a browser. |
| 12 | Expected behaviour: URLs are registered only when a build renders released pages. Test added. |
| 13 | Fixed: media settings Save and drawer Save metadata are disabled until dirty; *New generation* is disabled without targets; the dialog preselects the default target. |

Also fixed (found on the way): a plain stored alt text, caption or navigation label was wrapped under the language being
edited instead of the default language, so editing `en` first in a `de`-default project lost the `de` value
(`MediaServiceImpl`, `PageReferenceServiceImpl`).

Verification notes:
- No UI fix was checked in a running app; the CSS-only fixes (5, 9, 11) have no regression tests (jsdom applies no
  component styles).
- `ui/.../schema.d.ts` is hand-edited (`TemplateDetail.warnings`). A regenerated file has the same field but reorders
  unrelated ones (springdoc ordering), so the minimal edit was kept.
- `ReleaseApiTest.searchFacet` fails when its class runs and passes alone; it fails identically on untouched HEAD.
- `spotlessCheck` flags `OctlChainCompileTest.java` (line endings, untouched by this task).
