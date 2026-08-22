---
id: M0.4.2
status: done
depends: [M0.4.1]
epic: m0-skeleton
feature: frontend-shell
area: frontend
---

# M0.4.2 — Design tokens & theming

## Context

Establish the visual foundation from §24.3 (design tokens, colour/type discipline,
dark theme, reduced motion) so all later UI consumes tokens, not raw values.

## Goals

- Implement `design/tokens.scss` with the exact `--sf-*` custom properties (palette,
  type scale with `--sf-font-ui/display/mono`, spacing, radius, shadow, motion).
- Add `typography.scss`, base reset, and light/dark themes via `[data-theme="dark"]`.
- Add the `prefers-reduced-motion` suppression (§24.3).
- Wire a theme toggle that persists per user.

## Acceptance criteria

- [ ] `tokens.scss` matches §24.3 verbatim (including `--sf-signal`/`--sf-amber`
      single-meaning discipline documented).
- [ ] Dark theme applies via `[data-theme="dark"]`; toggle persists.
- [ ] A smoke screen demonstrates tokens and passes an automated contrast matrix check
      (the contrast test itself can be lightweight here; full CI matrix arrives in M7).

## Out of scope

- Component styling beyond a sample surface.
- A11y audit (M7).

## Notes / hazards

- Colour discipline (§24.3): `--sf-signal` for the single next action, `--sf-amber` for
  "not on the record" only.
