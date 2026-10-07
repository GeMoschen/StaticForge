---
id: M35.23
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.23 — Changes, schedules and release dialogs

## Context

`features/changes/*` (the reference-quality list), `features/schedules/*`, `features/release/*` (`release-bar`,
`release-dialog`, `release-plan`, schedule dialog). Screenshots 15–16, 70–72, 75–77. User decision 20: Changes keeps
one row per language.

## Goals

- **Changes:**
  - Moves onto `sf-data-table`, keeping every current capability: URL filters, chips, bulk Release/Discard/Schedule,
    row keyboard, pager, diff pane.
  - The filter bar is compacted into one row (search, type, status, language, changed by, folder, sort) with chips
    below only when active.
  - Rows show names, never record UUIDs; UIDs appear in developer mode.
  - The default language is listed first.
  - Fix the page height (M35.1 item 11): the table fills the frame.
  - The diff pane sits in an `sf-splitter`.
- **Schedules:**
  - `sf-data-table`; row actions in a ⋮ menu; Cancel with confirm.
  - Header action *New schedule* with a kind choice: release, unpublish, generation. Release schedules can be created
    here.
  - The history drawer (`sf-drawer`) has a full title.
- **Release dialog:**
  - One heading hierarchy. Language selection pre-ticks every changed language.
  - "All changed languages" is not styled as an error.
  - Warnings need the explicit confirmation (M33).
  - Blocking errors come with *Open* links.
- **Schedule dialog:** the title and kind are always explicit ("Schedule release" / "Schedule unpublish"), with a
  switch between them.
- **Release bar:** removed as a separate strip. Its actions move into the page header of every releasable editor
  (M35.18, M35.20, M35.22); this task provides the shared `sf-release-actions` component.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

**Signed off with M35.12 (gate decisions 41–46):** filter bars use the **normal control size** (as tall as the search
field; the shared `sf-data-table` toolbar already does), type filters show the type's icon, an open list item's row uses
`sf-data-table` `currentKey` (highlight + accent bar + `aria-current`), dialog footers use `<ng-container sfDialogFooter>`,
and list + detail panes are bordered cards with the splitter handle centred in a gap (`--sf-splitter-gap`).

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] No capability of Changes lost (checklist in notes). Vitest specs updated. `npx vitest run` and `npx ng build`
      green.

## Notes (M35.9)

- `sf-release-actions` is a group of its own in the editor header: spacing and a vertical divider separate its ⋮
  from the item's own ⋮ (M35.9 decision 34).
- `.sf-sr-only` is pinned to its containing block's corner (`top: 0; left: 0`), so hidden labels can't stretch scroll
  areas; the local `position: relative` workarounds in the changes list and admin tables are no longer required.
- Sample (decision 26) is the reference: the one-row-per-language list (compact filter bar, chips only when active,
  selection, bulk Release / Discard / Schedule) with the diff pane open in an `sf-splitter`; the release dialog
  (changed languages pre-ticked, warnings needing explicit confirmation, a blocking error with an Open link); the
  schedules list (⋮ row actions, New schedule: release / unpublish / generation); the schedule dialog (explicit title,
  kind switch).

## Notes (M35.23 part C): Changes — "no capability lost" checklist

Written before the rebuild from `features/changes/*` as it stood at `69191aae`; every item is ticked at the end of part C.

**URL and query**
- [x] The query string holds `type` (repeatable), `status` (repeatable), `locale` (repeatable, `""` = every language), `changedBy`, `folder`, `q`, `sort`, `page` (0-based); defaults are left out; unknown or malformed values fall back; a filter change returns to page 0; deep links work and back/forward re-reads the list.
- [x] The API request is unchanged (`queryFromState`: page size 50, `folderUuid`, shared locale key as an empty parameter).
- [x] The list re-reads on a project change, on every release event (`ReleaseEventsStore.version`) and after Release / Discard / Schedule; the members are loaded for the "changed by" names; a stale request is cancelled.

**Filter bar and chips**
- [x] Search by name or UID (debounced 300 ms, the typed text is not overwritten while typing).
- [x] Type filter (all seven releasable types, each with its icon), status filter (New, Changed, Deletion pending, Unpublished), language filter (only in a localized project), changed by (project members), folder (folders of all five stores as "Pages › About"), sort (newest, oldest, name A–Z, Z–A). Several types, statuses and languages can be picked at once.
- [x] Removable chip per picked value (type, status, language incl. "All languages", changed by, folder, search text) and "Clear all"; chips only while a filter is set.

**Table**
- [x] One row per (asset, language); the default language is listed first within its asset.
- [x] Columns: name with type icon (type name for screen readers) and UID (developer mode only, copyable), folder, language ("All languages" for the shared key; only in a localized project), status with a clock when a release is scheduled, changed (relative time + "by <member name>"), released (relative time or "—").
- [x] Rows show names, never UUIDs; the changed-by column shows the member name.
- [x] Selection checkboxes only for people who may release; select all on this page (indeterminate), Space toggles; the selection clears on a new page, filter or finished action.
- [x] Row keyboard: ↑/↓ move, Space selects, Enter opens the diff, one tab stop.
- [x] Pager (page X of Y) and the total count; the table fills the frame.
- [x] Loading skeleton, empty state ("Everything is published" / "No changes match" with filters), error state with Retry.

**Selection actions**
- [x] Bulk bar with the selected count: Release…, Discard changes… (only the rows that have a released version; a hint when none do), Schedule release… (only with the schedule permission); not offered to people who may not release.
- [x] Alt+Shift+R releases the selection (listed in the `?` sheet and the palette).
- [x] The three dialogs get the selected rows as choices (asset, language, label with status, type, name, folder).

**Diff pane**
- [x] A row opens its released-to-draft diff beside the table (the open row is highlighted); the pane shows name, type, language, status, "Open in editor", close; the legend (left released, right draft); the per-status notes (never released, deletion pending, unpublished); loading and error states; the field diff with language labels.
- [x] The diff follows its row after a re-read and closes when the row is gone.

**Page**
- [x] Heading and hint, the read-only label for a read-only project.

**Outcome (part C).** All items above are met. Deviations from the sample, all kept capabilities of the old screen:
the type, status and language filters take several picks (the URL holds them as repeated parameters; the sample has one pick
per filter); a *Released* column stays (the sample has none); the folder column is developer-mode only (as in the sample,
it used to show for everyone); the pane has no split/inline switch (the real diff is the structured `sf-diff`); the pager is
the page's own (below the table), because the URL, not the table, holds the page. The open row is not in the URL (as before).
Opening the pane re-creates the table (as History does); the selection is kept.
