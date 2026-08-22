---
id: M7.1.1
status: done
depends: []
epic: m7-hardening
feature: a11y
area: frontend
---

# M7.1.1 — Accessibility sweep

## Context

Implement + verify the §24.7 requirements across every route.

## Goals

- Visible 2px `--sf-signal` focus ring (2px offset, never removed; `:focus-visible` for
  pointer users).
- Full keyboard: command palette, `g p/m/t/r`, save/preview shortcuts, drag alternatives
  (§24.6), resizable panels via `Arrow` keys.
- Semantic structure: landmarks, one `h1` per view, heading order, `aria-current="page"`.
- Live regions: save state, generation progress, validation summaries (polite; errors
      assertive).
- Rich text toolbar as a proper toolbar widget (`Alt+F10` entry); media alt required
      before publish.
- axe-core checks in Playwright per screen.

## Acceptance criteria

- [ ] Every route passes axe with no serious/critical violations.
- [ ] Keyboard-only editing + publishing is possible (journey 12).

## Out of scope

- Manual screen-reader pass (QA follow-up per release, §24.7).

## Notes / hazards

- Zoom to 200%, text-spacing overrides supported.
