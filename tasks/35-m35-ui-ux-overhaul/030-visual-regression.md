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

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [ ] The suite passes twice in a row on this machine (no flakiness). Baselines committed.
- [ ] `docs/` or `ui/e2e/README` describes how to run and update it.

## Notes (M35.9)

- The gate was reviewed from 198 headless-Chrome screenshots (exact widths, full page; theme × density × 1440/1024,
  one collapsed-rail shot per theme). Reuse that capture approach and its screen list. The style guide and
  `/styleguide/sample` use fake data and can be baselined first.
