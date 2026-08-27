# Feature: Shared "Create asset" dialog

**Spec:** UI-quality pass replacing every ad hoc asset-creation interaction
in the app with one shared, professional modal dialog.

## Goal

Today, "create a folder" is a raw `window.prompt('Folder name')` in three
different components (`pages-list.component`, `media-library.component`,
`navigation.component`) — no validation, no visual styling, not even
matching the app's own design language. Template creation
(`templates.component.newTemplate`) has no dialog at all — it immediately
creates a placeholder the user must rename afterward (partially addressed by
`M12.1.2`, but the creation moment itself should ask for a name up front,
the way page creation already does). Only page creation
(`pages-list.component`'s `openNewPage`/`newPageForm`) has a real, in-house
modal-like panel with a reactive form — but it's a one-off, not shared.
Extract one shared, adaptable "Create asset" dialog component and use it
everywhere.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-shared-create-dialog-component.md](001-shared-create-dialog-component.md) | — |
| 2 | [002-wire-create-dialog-everywhere.md](002-wire-create-dialog-everywhere.md) | 1 |

## Feature exit criteria

- [ ] One shared, standalone dialog component exists and adapts its fields to
      what it's creating (folder: name only; page: name + template; template:
      name [+ kind if not already fixed by context]; navigation reference:
      name/label + target).
- [ ] Every `window.prompt(...)` call for asset creation is removed, replaced
      by this dialog.
- [ ] `pages-list.component`'s existing one-off new-page panel is replaced by
      the shared dialog (not kept as a second, parallel implementation).
- [ ] Loading, validation, and error states match this codebase's established
      bar (`media-detail-drawer.component`, `project-settings-import.component`).

## Dependencies

`DialogService` (`ui/src/app/core/ui/dialog.service.ts`) exists today but
only for confirm/message dialogs (no form hosting) — this feature adds a new
shared component rather than extending that service; see
`001-shared-create-dialog-component.md` for the reasoning. Each target
screen's existing create endpoint/service method
(`ApiClient.createFolder`/`createPage`, `TemplatesService.create`,
`NavigationService`'s folder/reference creation methods).
