---
id: M35.5
status: done
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

- [x] `tokens.contrast.spec.ts` extended: text/background pairs ≥ 4.5:1, UI boundaries ≥ 3:1, in both themes.
- [x] Theme switch light/dark/system and density switch work at runtime without reload and persist per user.
- [x] No undefined `var(--sf-…)` left (script check in the test suite).
- [x] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- Until M35.9 is signed off, the look may change. Keep values in tokens, never in components.

## Review (2026-09-30)

- `ui/src/app/design/`: `_primitives.scss` (slate, blue 600 = #2563eb, green/amber/red/cyan), `_semantic.scss` (light and
  dark mixins; `prefers-color-scheme` applies with no attribute, so no flash for the system theme), `_scales.scss` (type,
  4 px spacing, radius, elevation, motion incl. reduced motion, z-index, layout sizes, density), `_aliases.scss` (legacy
  names, "alias — remove in M35.27", also defines every formerly undefined token).
- `ThemeService` / `DensityService` (`core/ui/`) go through `PreferencesService`, set `data-theme` / `data-density` on
  `<html>` at runtime, follow `matchMedia` live for `system`; `provideAppearance()` starts them. Density default is now
  **compact** (PreferencesService default and spec changed). Fonts: `@fontsource-variable/inter` and
  `jetbrains-mono` 5.3.0, self-hosted; Fraunces removed. Material Symbols still loads from the Google CDN (decision 5
  keeps the icon set; self-hosting is a separate step).
- Lint: `npm run lint:tokens` (`scripts/check-tokens.mjs`, baseline `tokens.baseline.json`: 55 files / 81 colour
  literals / 45 raw z-index, may only shrink; 219 px literals are warnings). Specs: `tokens.contrast.spec.ts` (text
  >= 4.5:1, UI boundaries >= 3:1, both themes; light `text-subtle` darkened to #5f6f86 to pass), `tokens.defined.spec.ts`,
  `theme.service.spec.ts`.
- Verified: `npx vitest run` 149 files / 1164 tests, `npx ng build` green (initial 1.87 MB, no budget change), `npm run
  lint` green. Login page checked in a browser in both themes and densities; authenticated screens not screenshotted.
- Open: a user whose theme differs from the system theme sees one flash on reload until the preferences load (nothing is
  cached synchronously now); `check-tokens.mjs` has no spec of its own; screens still use aliases until M35.27.
