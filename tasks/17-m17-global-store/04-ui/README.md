# Feature: Globals store UI

**Spec:** Extends §23.2 (Angular feature layout), §23.5 (dynamic form engine), §24.5 (core
screens), §24.6/§24.7 (interaction rules, accessibility).

## Goal

A new **Globals** entry in the project nav rail opens a store screen with the same shape
as the Navigation and Media stores: a folder tree on the left and a detail area on the
right. The detail area shows a selected property set in two tabs:

- **Values**: the set's `compiledDefinition` rendered through `sf-content-form`, saved
  with `If-Match`. Visible to everyone, editable by `EDITOR` and above.
- **Schema**: the CDL source with live `SF-CDL-*` diagnostics. Visible to everyone,
  editable by `DEVELOPER` and above.

The whole surface is read-only during time travel.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-globals-store-ui.md](001-globals-store-ui.md) | `M17.2.1` |

## Feature exit criteria

- [ ] Sets can be created, organized in folders, edited (values and schema), renamed,
      moved and deleted from the UI, with role-appropriate controls.
- [ ] The Globals store is selectable in the export picker (`project-settings-export.component.ts`).
- [ ] Everything is keyboard-operable and read-only during time travel.

## Dependencies

`M17.2.1` (API + regenerated `schema.d.ts`), `M3` (form engine), `M8.1.6` (store UI
precedent), `M15.5` (time-travel read-only backstop and surface gating).
