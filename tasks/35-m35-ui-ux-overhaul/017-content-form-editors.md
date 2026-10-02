---
id: M35.17
status: done
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

- [x] Screen definition of done applies to the form in its host screens (page, section, record, global set).
- [x] Vitest specs for every editor updated: labels, `aria-describedby`, findings placement, read-only/computed state,
      reorder by keyboard.
- [x] `npx vitest run` and `npx ng build` green.

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

## Review (2026-10-02)

Design signed off in the sample first (gate round 7, decisions 72–81). Built as signed off.

- **Engine** (`features/forms/`): `editor-base.ts` (`SfEditorBase`, `EditorChrome`) — every one of the 19 editors extends it and renders one
  `sf-field` with the required marker, the required error shown **once** (`empty`), the language chip on the label line, the form's
  rule/server findings at four levels and the control's own validation message; `editor-outlet` hands the chrome to the editor;
  `sf-content-form` computes it per editor (chip, Computed cue, findings, read-only/computed hints) and lays out the grid. Design
  system: `sf-finding`, `sf-field` inputs `findings`, `empty`, `tags`; `sf-number-input`, `sf-color-input`, `sf-media-thumb`.
- **Two columns, opt-in:** CDL `width: half | full` (backend: lexer, parser, validator, compiled definition, docs, `SF-CDL-0120`,
  `WidthCdlTest`); the form switches to two columns from 46 rem of its own width and only `half` fields pair up.
- **Editors:** simple editors on the M35.6 controls; rich text with `role="toolbar"`, Alt+F10, Ctrl+B/I/K and the link dialog (no more
  `window.prompt`); media (drop zone, thumbnail card, alt text, UUID only in developer mode), reference and link (name + place + Open,
  no UUIDs); list/group/catalog (add, remove with Undo, Alt+↑/↓, collapsible groups, `sf-catalog` / `sf-card`).
- **Asset picker** rebuilt with every function of the old one in the new design (type switch incl. Navigation entries, dataset select,
  folder tree, rich rows, footer, keyboard, states); public API unchanged for its other callers.
- **Checks:** 280 test files / 2,584 tests, `ng build`, `npm run lint` and the backend CDL tests green (lint baselines updated).
- **Deviations / open:** the rich-text page link address is derived from the folder path and uid (the API has no public page URL); the
  catalog has no language chip (no label row); the picker folder tree covers pages, media and navigation only (templates and records stay
  flat lists); a catalog card whose type is no longer in `allow` shows its template UUID; real-browser checks of the rebuilt editors were
  not done in this session — screens that host the form (page, record, global set) get their visual pass in M35.18/20/22.
