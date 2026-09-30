---
id: M35.6
status: todo
depends: [M35.5]
epic: m35-ui-ux-overhaul
feature: design-system
area: frontend
---

# M35.6 — Base components and form controls

## Context

`shared/components/` (`sf-button`, `sf-field`, `sf-empty-state`, `sf-spinner`, `sf-tabs`, `sf-icon`),
`shared/directives/sf-tooltip.directive.ts` (unused), `design/_forms.scss`. User decisions 1–5, 12, 21.

## Goals

- **`sf-button`:**
  - Variants: primary, secondary, ghost, danger, danger-ghost.
  - Sizes: sm, md.
  - Leading and trailing icon.
  - Icon-only mode, which requires `label` (rendered as `aria-label` plus tooltip).
  - `loading` (spinner, `aria-busy`, blocks double submit).
  - A disabled state that clearly reads as disabled.
  - Passthrough of `type`, `aria-*` and `routerLink` (renders an `<a>`).
- **Form controls:** input, textarea, select, combobox (single and multi, with type-ahead), checkbox, radio group,
  switch, segmented control, date/time/datetime, number, file picker with drop zone, search input (clear button,
  `/` focus hook), color, and slider only if an editor needs it.
  - All are `ControlValueAccessor`.
  - All follow density and theme.
  - All have a readable read-only state in dark mode.
- **`sf-field`:**
  - Label, optional/required marker, hint and error slot.
  - Wires `aria-describedby` and `aria-invalid`.
  - Label position top (default) or inline.
  - The field label must not leak into the accessible name of buttons placed inside the field (see memory note on
    `sf-field` wrapping a `<label>`).
- **Display components:**
  - `sf-badge` / `sf-status` (status pill with icon plus text, colour never the only cue), `sf-tag` (removable chip),
    `sf-kbd`, `sf-avatar`.
  - `sf-copyable` (monospace id plus copy button, used for dev-mode identifiers).
  - `sf-relative-time`, with the absolute time in its tooltip.
- **`sf-tooltip`:** hover and focus, delay, Escape dismiss, `aria-describedby`, no `title` attributes.
- **`sf-tabs`:** the single tab implementation.
  - Extend it with a router mode (`<a>` links with `aria-current`) for page-level navigation.
  - Add an overflow menu for many tabs.
- **Page layout primitives:**
  - `sf-page-header`: breadcrumb slot, title (`h1`), subtitle, status, actions, secondary actions menu.
  - `sf-toolbar` (with `role=toolbar` and arrow keys).
  - `sf-section` (titled card with a heading level input).
  - `sf-empty-state` with a heading level input, illustration icon and primary/secondary action.
  - `sf-skeleton` (text, row, tree, table and form shapes).
  - `sf-banner` (info, warning, danger; dismissible).
- **Remove** `sf-spinner`-less "Loading…" texts as consumers migrate. Keep `sf-spinner` for inline use.

## Acceptance criteria

- [ ] Every component has a vitest spec covering roles, labels, keyboard and states.
- [ ] Every component follows light/dark and compact/comfortable (shown in M35.9).
- [ ] Every string goes through Transloco.
- [ ] `npx vitest run` and `npx ng build` green.

## Out of scope

- Migrating screens (M35.16–M35.26). Overlays, table and tree (M35.7, M35.8).
