---
id: M35.30
status: todo
depends: [M35.27, M35.28, M35.29]
epic: m35-ui-ux-overhaul
feature: closing
area: qa
---

# M35.30 — Visual regression baselines

## Context

User decision 25. Playwright is installed in `ui/node_modules`, and journeys are gated on `SF_RUN_E2E`.

## Goals

- A deterministic visual suite, `ui/e2e/visual/*.spec.ts`, with:
  - its own seed (fixed names, dates frozen via clock mocking, no relative times drifting)
  - animations disabled
  - fonts loaded before capture
- Baselines (`toHaveScreenshot`) for the key screens: login, dashboard, project home, pages folder table, page editor
  with preview, media grid and detail, record set, record editor, templates IDE, changes, publishing runs and run
  detail, settings general, history drawer, command palette, shortcut sheet, confirm dialog, and the style guide.
- Variants: light and dark × compact at 1440, comfortable light at 1440, light at 1024, and review mode at 390 for the
  review screens.
- A documented update procedure: update baselines only deliberately, and review the diff (like the quality golden
  fixture).

## Acceptance criteria

- [ ] The suite passes twice in a row on this machine (no flakiness). Baselines committed.
- [ ] `docs/` or `ui/e2e/README` describes how to run and update it.
