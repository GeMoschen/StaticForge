---
id: M35.24
status: todo
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.24 — Publishing, quality, redirects, URL registry

## Context

`features/generation/*` (runs, run detail with custom tabs, live log, generation dialog), targets, publish policy,
`features/settings` quality, redirects and URL registry. Routes from M35.11. Screenshots 82–84, 86, 88–89 and E9.

## Goals

- **Publishing → Runs:**
  - `sf-data-table`: status, mode, target, trigger, started, duration, pages, findings.
  - One line per cell, with details in the run view.
  - Primary *Build now*, disabled with a reason when there is no target (links to Targets).
- **Run detail:**
  - A summary header (status, counts, duration), then `sf-tabs` Summary | Rebuilt | Findings | Log.
  - Findings grouped by code with a count; they name the page, link to it, and say how to fix.
  - Logs are monospace, virtualized and follow the tail.
- **Build now dialog:**
  - Target select preselects the default.
  - Mode (full, incremental) as a segmented control.
  - Dry-run plan preview.
  - Page scope picker as a real picker, not text-looking links.
- **Targets:** `sf-data-table` with Delete in ⋮ (confirm). The form is in a drawer.
- **Publish policy:** a settings form with the save UX.
- **Quality:**
  - A summary first (rules on/off counts, last results), then rules grouped by category, keeping the segmented
    Off/Warning/Error control.
  - The long explanations become hints and tooltips.
- **Redirects and URL registry:**
  - `sf-data-table`s with aligned filters.
  - Destructive actions (Reset all) are hidden in empty states and live in ⋮ with a typed confirmation.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Vitest specs updated. `npx vitest run` and `npx ng build` green.

## Notes (M35.9)

- Navigation inside Publishing is the `sf-side-nav` (Runs, Targets, Policy, Quality, Redirects, URLs; decisions 28-30).
  Quality, Redirects and the URL registry belong here, not in Settings.
- Sample (decision 27) is the reference: runs table; run detail (Summary | Rebuilt | Findings | Log, one run still
  running with a live log tail); the Build now dialog (target preselected, Full/Incremental, dry-run plan, page scope
  picker); targets (table, form in a drawer) and the publish policy form; quality (summary, rules by category with
  Off/Warning/Error); redirects and the URL registry (tables with aligned filters, destructive actions in ⋮ with a
  typed confirmation).
- Drawers (the targets form): see the open question on drawers over the top bar (M35.19).
