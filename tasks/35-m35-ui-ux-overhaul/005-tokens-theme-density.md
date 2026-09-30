---
id: M35.5
status: todo
depends: [M35.3]
epic: m35-ui-ux-overhaul
feature: design-system
area: frontend
---

# M35.5 — Design tokens v2, theme and density

## Context

`ui/src/app/design/tokens.scss`, `typography.scss`, `_forms/_table/_dialog-shell/_interactive.scss`,
`core/ui/theme.service.ts`, `tokens.contrast.spec.ts`. User decisions 1–5.

## Goals

- **Primitive palette:**
  - Slate neutrals 0–950.
  - Blue accent ramp (≈ `#2563eb` at 600).
  - Green, amber, red and cyan ramps.
- **Semantic tokens**, the only ones components may use:
  - Surfaces: `bg`, `surface`, `surface-raised`, `surface-sunken`, `overlay`.
  - Text: `text`, `text-muted`, `text-subtle`, `text-inverse`.
  - Borders: `border`, `border-strong`.
  - Accent: `accent`, `accent-hover`, `accent-subtle`, `on-accent`.
  - Status: `success`, `warning`, `danger`, `info`, each with `-subtle` and `-text`.
  - States: `focus-ring`, `selection`, `hover`, `disabled-bg`, `disabled-text`.
  - Code editor palettes, light and dark.
- **Scales:**
  - Font scale for Inter: 12/13/14/16/18/20/24/30, with line heights and weights 400/500/600.
  - Spacing on a 4 px grid.
  - Radius: 4/6/8.
  - Elevation: 0–3, tuned separately for dark.
  - Motion: durations and easings, respecting `prefers-reduced-motion`.
  - A **z-index scale**: base, sticky, dropdown, drawer, modal, popover, toast, tooltip.
  - Layout sizes: top bar, rail (collapsed and expanded), tree default width.
- **Density:**
  - `data-density="compact|comfortable"` on `<html>` drives control heights (28/32 compact, 32/40 comfortable), row
    heights and paddings.
  - Compact is the default.
- **Theme:**
  - `data-theme="light|dark"`, resolved from the preference `system|light|dark`, following `prefers-color-scheme` live
    when set to `system`.
  - `ThemeService` and the new `DensityService` read and write through `PreferencesService` (M35.3).
- **Fonts:**
  - Inter and JetBrains Mono, self-hosted (no CDN).
  - Remove Fraunces.
- **Cleanup:**
  - Define or remove every undefined token (`--sf-radius`, `--sf-muted`, `--sf-canvas`, `--sf-danger`, `--sf-panel`,
    `--sf-hover`, `--sf-ink-soft`, `--sf-surface-muted`, `--sf-signal-muted`, `--sf-shadow-md/lg`, `--sf-amber-700`,
    `--sf-text-2xs`).
  - Keep old token names as aliases only until the screens migrate. Remove the aliases in M35.27.
- **A stylelint rule** (or script) that forbids hex, rgb and hsl colours and raw z-index outside `design/`. It reports
  px literals as warnings until the screens migrate.

## Acceptance criteria

- [ ] `tokens.contrast.spec.ts` extended: text/background pairs ≥ 4.5:1, UI boundaries ≥ 3:1, in both themes.
- [ ] Theme switch light/dark/system and density switch work at runtime without reload and persist per user.
- [ ] No undefined `var(--sf-…)` left (script check in the test suite).
- [ ] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- Until M35.9 is signed off, the look may change. Keep values in tokens, never in components.
