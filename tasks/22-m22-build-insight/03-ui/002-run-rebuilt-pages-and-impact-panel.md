---
id: M22.3.2
status: todo
depends: [M22.2.1, M22.2.2, M22.3.1]
epic: m22-build-insight
feature: ui
area: frontend
---

# M22.3.2 — Run "Rebuilt pages" tab + asset Impact panel

## Context

`ui/src/app/features/generation/generation.component.html/.ts` lists runs with an
expandable details row: dates, channels, target, revision, file/byte counts, and
diagnostics grouped by code. Nothing shows which pages a run rebuilt.

Asset editors have no transitive dependency view. The media detail drawer
(`features/media/media-detail-drawer.component.*`) shows one-hop usages. The template
editor (`features/templates/templates.component`) and page editor
(`features/pages/page-editor.component`) show nothing.

After `M22.2.*`: `GET /generations/{runId}/plan`, `GET /assets/{uuid}/impact`, and
`GenerationRunView.planSummary`. `M22.3.1` provides `sf-rebuild-reason` and
`sf-plan-entries-table`.

## Goals

- **Run history:**
  - The table shows `planSummary` inline: "Incremental · 37 pages (via 2 changes)" or
    "Full · 5,000 pages".
  - The details row gains tabs "Summary" (today's content) and "Rebuilt pages". The
    latter is `sf-plan-entries-table` over `getRunPlan`, with root kind/channel/text
    filters.
  - `planAvailable: false` shows "Plan details were pruned (retention)".
- **Shared `sf-asset-impact` panel:**
  - Input: `projectKey`, `assetUuid`. Loads `GET /assets/{uuid}/impact` lazily when the
    panel is expanded.
  - Header: "Changing this rebuilds N pages (M files)" plus a by-edge breakdown.
  - Body: paged `sf-plan-entries-table` in impact mode. The root is the asset itself,
    so the chain is rendered from the entry to "this asset".
  - Entries link to the page editor.
  - Labelled "as of now". In time travel, show "Impact reflects the current state, not
    revision N".
- **Placement:**
  - Template editor side panel (page and section templates).
  - Media detail drawer, below the existing usages list. Keep usages; impact is the
    transitive view.
  - Page editor side panel.
  - Globals, records, datasets and processed media editors (`M17`–`M19`) add the same
    component when those epics land. Note this in their epics; don't add placeholders
    here.
- **Refresh:** reload impact after the asset is saved (the reference rows change on save
  after `M16.3.1`).
- Specs: run tabs + pruned state; impact panel lazy loading, empty state (0 pages),
  paging, time-travel label.

## Acceptance criteria

- [ ] Every finished run with a stored plan shows its rebuilt pages with reasons.
- [ ] Impact panel appears in the template editor, media drawer and page editor, and
      matches the endpoint result against a running backend (spot-checked with a media
      file used by 2 pages and a section template used by several pages).
- [ ] Impact loads only on expand (no request on editor open), verified in a spec.
- [ ] Keyboard-complete; chains readable by screen readers (ordered lists, text edge
      labels).
- [ ] `npm run build` green; specs pass, or their failure is shown to be the known
      `templateUrl` tooling issue.

## Out of scope

- A graph visualization of the dependency network (a list of chains is enough here).
- Impact for folders, navigation folders or channels as a whole.

## Notes / hazards

- Keep the one-hop usages list in the media drawer. It is used to block deletion
  (`softDelete` rejects referenced assets) and answers a different question.
- Impact on a base template can be the whole site. The header count comes from
  `entryCount`, so it's cheap; don't fetch entries until the list is expanded.
