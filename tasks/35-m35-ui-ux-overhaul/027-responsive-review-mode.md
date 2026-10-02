---
id: M35.27
status: todo
depends: [M35.16, M35.17, M35.18, M35.19, M35.20, M35.21, M35.22, M35.23, M35.24, M35.25, M35.26]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.27 — Tablet layout and review mode

## Context

User decision 13. Today only 8 of 126 stylesheets have media queries. At 390 px the editor can't be reached; at
1024 px the preview and OCTL pane are clipped. Spec §24.4 asks for an honest review mode below 840 px.

## Goals

- **1024–1279 px:**
  - The rail auto-collapses.
  - Tree panes become overlay drawers toggled from the header.
  - Editor and preview switch to tabs.
  - Tables hide low-priority columns (column priority in `sf-data-table`).
  - Nothing is clipped horizontally.
- **Below ~840 px (review mode):**
  - The top bar is condensed (switcher, search, menu).
  - The rail becomes a bottom sheet or menu.
  - Available: browse Pages, Media and Content; open read-only previews; Changes; release and schedule; History.
  - Template, schema, settings and code editing show an honest empty state ("Open on a larger screen to edit
    templates").
  - Tables become card lists.
- **Cleanup:** remove the token aliases (M35.5), make the style lint's px warning an error for `src/app/features`, and
  make the `window.*` lint rule an error.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [ ] Screenshots at 1024 and 390 reviewed for every screen. No horizontal page scroll.
- [ ] Style and `window.*` lint are errors and green.
- [ ] `npx vitest run` and `npx ng build` green.

## Notes (M35.9 / M35.10)

- The gate's screenshots were taken at 1440 and 1024 (plus a collapsed rail); the 1024 shots of the sample are the
  reference for what must not clip. M35.10 left the page editor's preview clipped at 1024, and `sf-side-nav` and
  `sf-splitter` need their narrow behaviour defined here.
