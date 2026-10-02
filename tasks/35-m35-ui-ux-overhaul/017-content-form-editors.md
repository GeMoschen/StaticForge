---
id: M35.17
status: todo
depends: [M35.10, M35.13]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.17 — Content form and editors

## Context

`features/forms/*`: `sf-content-form`, `form-builder.service`, `editor-outlet`, and every editor (text, textarea, rich
text with `window.prompt('Link URL')`, number, date, select, radio, checkbox, media, link/reference, list, group,
dataset/record references…). Used by the page, section, record and global-set editors. This is the ugliest part of the
current UI: native 20 px inputs with black borders (screenshots 11–13, 32, 61). Rule findings, field states and fills
come from M33.

## Goals

- Every editor is built on the M35.6 controls inside `sf-field`: label, required marker, hint, inline findings per
  level (hint, info, warning, error), readable read-only and computed states.
- **Language chip** ("English", "All languages") only when the template or dataset is localized. It sits inline to
  the right of the label, not above it.
- A required error is shown **once**. Merge the client "This field is required" with the server rule finding.
- **Media editor:**
  - A thumbnail card with name, dimensions, *Choose* / *Replace* / *Remove*, drop zone, and an alt text field.
  - No raw "Media UUID" input. The UUID appears only in developer mode via `sf-copyable`.
- **Reference and link editors:** show the target's name and URL with an *Open* link. Pick through the asset picker
  (restyled). No raw UUIDs.
- **Rich text:**
  - A `role=toolbar` with icon buttons, `aria-pressed` and tooltips.
  - `Alt+F10` focuses the toolbar.
  - The link dialog (`sf-dialog` with URL, internal page picker, open in new tab) replaces `window.prompt`.
- **Lists and groups:**
  - Add, remove (undo) and reorder by drag and by `Alt+↑/↓`.
  - Collapsible groups with a summary line.
- **Layout:** a form grid that follows density, with optional two-column layout for short fields at ≥ 1280 px. The
  editor order is kept.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [ ] Screen definition of done applies to the form in its host screens (page, section, record, global set).
- [ ] Vitest specs for every editor updated: labels, `aria-describedby`, findings placement, read-only/computed state,
      reorder by keyboard.
- [ ] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- Keep the `data-sf-editor` / `data-sf-section*` / `data-sf-page-fields` hooks.

## Notes (M35.9)

- Editor forms span the full available width of their pane, with no centred max-width column (M35.9 decision 33).
- **Catalog and card fields** use `sf-catalog` / `sf-card` (M35.9 decisions 7-11), framed like sections: a bordered
  panel with a header bar (drag handle, type icon, "Type · summary", collapse, ⋮ menu); nested catalogs are indented
  panels inside the body. The summary is the card type plus the value of its first text-like field, "Untitled" when
  empty. Cards open expanded; collapse state is remembered per field for the browser session; the catalog header has
  "Collapse all / Expand all". Add through an "Add card" menu button with the allowed types, plus a "+" between cards on
  hover/focus to insert there. Reorder by drag and `Alt+↑/↓`.
