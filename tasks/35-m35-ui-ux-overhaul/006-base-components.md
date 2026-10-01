---
id: M35.6
status: done
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

- [x] Every component has a vitest spec covering roles, labels, keyboard and states.
- [x] Every component follows light/dark and compact/comfortable (shown in M35.9).
- [x] Every string goes through Transloco.
- [x] `npx vitest run` and `npx ng build` green.

## Out of scope

- Migrating screens (M35.16–M35.26). Overlays, table and tree (M35.7, M35.8).

## Review (2026-10-01)

Everything lives in `ui/src/app/shared/`:
- **Foundation.** `components/forms/sf-control.ts` (`SfControlBase`: CVA, disabled/readonly/required/invalid, `aria-*`
  forwarding, link to the field) and `sf-field-context.ts` (`SF_FIELD`); `overlay/anchored-position.ts` (fixed panels
  placed next to an anchor, flipped and clamped, moved into `<body>` while open so dialog transforms and clipping can't
  offset them); `design/_forms.scss` (control mixins incl. a shell for inputs with adornments) and `design/_tooltip.scss`.
- **`sf-button`** (backward compatible): variants incl. `danger-ghost`, sizes, leading/trailing icon, icon-only via
  `label`, `loading`, `disabled` + `disabledReason` (focusable, reason in the tooltip), `link`/`href` → `<a>`, `aria-*`
  forwarded to the inner element. Blocked clicks never reach `(click)` on `<sf-button>`.
- **`sf-field`**: `<label for>` instead of a wrapping `<label>` (no more label leaking into button names), required/
  optional marker, hint, `error` + projected `[sfFieldError]`, `aria-describedby`/`aria-invalid`/`aria-required` on our
  controls (DI) and on projected native inputs (DOM), radios/checkbox sets as a labelled group, label top/inline.
- **Controls** (`components/forms/`, all CVA): input, textarea, select, number, date/time/datetime, search (clear,
  Escape, `/`), color, file drop, checkbox, radio group, switch, segmented, combobox (single/multi, type-ahead,
  ARIA 1.2), slider.
- **Date/time picker** (follow-up, user): no native picker. Dates are typed in the UI locale's order (`MM/DD/YYYY`,
  `DD.MM.YYYY`; ISO always works) or picked in a modal calendar dialog (`sf-calendar`: APG date-picker grid, locale week
  start, day/week/month/year keys, min/max, Today/Clear, `Alt+↓` from the field). Times are typed (`14:30`, `2:30 pm`,
  `1430`) on the locale's clock or picked from a combobox time list (`minuteStep`). Pattern placeholders, format hint
  in the description, value strings unchanged (`yyyy-MM-dd`, `HH:mm`, `yyyy-MM-ddTHH:mm`). Parsing and calendar maths
  in `date-time.util.ts`.
- **Slider** (follow-up, user): the native range (keys, touch, `role=slider`) restyled with tokens, value shown and
  announced (`aria-valuetext`) in the locale format with a unit; read-only blocks changes.
- **Display** (`components/display/`): badge, status, tag, kbd, avatar, copyable, relative-time.
- **Layout** (`components/layout/`): page-header, toolbar, section, skeleton, banner; `sf-empty-state` (heading level,
  actions) and `sf-spinner` (sizes, styles out of inline `styles`) upgraded.
- **`sf-tabs`**: router mode (`<nav>` of links, `aria-current="page"`), "More" overflow menu (selected/active tab always
  visible); projected controls now sit outside `role=tablist`.
- **`sf-menu`** (`components/menu/`): a minimal menu button, needed for tab overflow and the page header. M35.7 extends
  it (noted in `007-overlays.md`). **`sfTooltip`** rewritten: hover delay, at once on keyboard focus, Escape, hoverable,
  `aria-describedby`, no `title`.

Verification: `npx vitest run` 184 files / 1,437 tests; `npx ng build` green (initial 1.91 MB, was 1.87; pre-existing
NG8102 warnings only); `npm run lint` green (token baseline shrank). Every component was checked in a browser in light
and dark and in both densities through a temporary preview page (not committed), including the popups inside a
transformed, clipping box. A review pass found seven defects, all fixed with specs: nested fields wiring each other's
inputs, `[attr.aria-*]` on `<sf-button>` no longer reaching the button (4 consumers moved to the forwarded inputs, 2
`title=` to `tooltip=`), Space on link menu items, popups offset inside dialogs, `reset()` keeping half-typed number/date
text, a loading router-link button still navigating, a combobox staying open when its form disables it.

Found on the way:
- `sf-field`'s label rendered as plain text until the first `afterRender`, so specs (and screen readers on the first
  frame) found no label; it is now right on the first render.
- Two dataset-editor specs clicked Save while it was still disabled and only passed because jsdom fires click listeners
  on disabled buttons (see `lessons.md`).
- The i18n literal lint didn't scan the new text inputs (`tooltip`, `disabledReason`, `subtitle`, `error`, `text`,
  action labels, `sfTooltip`); it does now.

Deviations:
- Consumers are not migrated (out of scope: M35.16–M35.26), so the "Loading…" texts without `sf-spinner` remain.
- `sf-relative-time` runs one 30 s timer per instance; a shared clock would suit long tables better.

Follow-up checks (2026-10-01): picker and slider checked in Chrome (en-US, light and dark, inside a clipping box). That
found two things, fixed with specs: `anchorPanel` ignored a panel's CSS `max-height`, so a long time list flipped above
the field with room below; the date placeholder showed an example date that read like a value (now `MM/DD/YYYY`).
