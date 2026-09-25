---
id: M30.6.2
status: todo
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

- [ ] Vitest specs with fixtures from the real API shape: chips, filters → query params, paging, carried marker,
      link to the page editor, truncated notice, stage label.
- [ ] Manual check with the golden fixture project.
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- Exporting findings (CSV), trends across runs.

## Notes / hazards

- Keep the filters in the URL (like the M26 audit view) so a findings view can be shared; show the chosen filters as
  chips (M26 journey defect: hidden multi-select state).
