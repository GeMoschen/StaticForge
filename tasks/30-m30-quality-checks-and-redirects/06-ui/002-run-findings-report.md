---
id: M30.6.2
status: done
depends: [M30.1.3]
epic: m30-quality-checks-and-redirects
feature: ui
area: frontend
---

# M30.6.2 — Generation run details: findings report

## Context

`features/generation/generation.component.{ts,html}` (run list and details; `diagnosticsOf` at ts `:158`, list at html
`:161`–`:172`, live diagnostics via `generation-sse.ts`), `generation-diagnostics.ts`, `insight/` (`sf-plan-entries-table`
as the paged-table model, `insight.util.ts` cause labels), `GenerationRunView.findingCounts`,
`GET /generations/{runId}/findings` (`M30.1.2`), SSE stage `CHECK`. Epic decisions 5, 10.

## Goals

- Run list: a findings chip per run (`3 errors · 41 warnings`, error chip only when > 0), separate from the existing
  diagnostics counts.
- Run details: a **Findings** section — counts by category and severity as filter chips, filters for code, channel,
  locale, path prefix, a paged table (output path, page display name linking to the page editor at that locale,
  rule name + code, severity, message, selector in a monospace tooltip, "carried" marker), `truncated` notice.
- Held-back pages from `SF-GEN-0125` appear in the existing diagnostics list and link to their findings (filter by that
  asset).
- Live progress shows the `CHECK` stage ("Checking output").
- Plan dialog: the two new fallback causes have labels (done in `M30.1.3`; verify they render).

## Acceptance criteria

- [x] Vitest specs with fixtures from the real API shape: chips, filters → query params, paging, carried marker,
      link to the page editor, truncated notice, stage label.
- [x] Manual check with the golden fixture project.
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Exporting findings (CSV), trends across runs.

## Notes / hazards

- Keep the filters in the URL (like the M26 audit view) so a findings view can be shared; show the chosen filters as
  chips (M26 journey defect: hidden multi-select state).
- Deviation: the manual check ran against a project seeded via the API with the same defect kinds (templates without
  title/alt, broken page and media links, a moved page, SF-CHK-0301 set to ERROR) — the golden fixture is built by
  the parallel golden lane. Fixtures in `findings/testing/findings.fixtures.ts` are captured from that backend.
- Held-back pages: the `SF-GEN-0125` message names the page by uid only, so "Show findings" parses it
  (`heldBackPage`, pinned to `QualityCheckStage.heldBackError`'s format) and reads the page's uuid from its `ERROR`
  findings; if none is stored it falls back to channel + language + codes + severity. A changed message format
  there must update `HELD_BACK_MESSAGE` in `findings.util.ts`.
- URL: `?run=&tab=findings&fSeverity&fCategory&fCode…&fAsset&fChannel&fLocale&fPath&fPage` (prefixed; the Generation
  settings view binds `tab` next to `run`). Also added: redirect counts (`redirectsAdded/redirectsActive`) in the run
  summary and the dry run's `redirectCandidates` in the plan dialog.
