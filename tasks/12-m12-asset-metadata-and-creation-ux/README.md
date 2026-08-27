# M12 — Asset metadata editing & unified creation UX

**Spec:** UI-only epic extending the asset-management screens (§10, §19–20)
already shipped for Pages, Media, Templates, Folders and Navigation. Not part
of the original §27 roadmap — inserted the same way `M8`/`M9`/`M10`/`M11`
were, as a UI-consistency and quality pass over already-shipped features
rather than new backend capability.

## Goal

Two independent UI gaps, both about parity and polish rather than new
backend surface:

1. **Metadata editing.** `MediaLibraryComponent`'s detail drawer
   (`media-detail-drawer.component`) already lets a user rename an asset's
   UID (via the shared `sf-uid-rename` component) and edit type-specific
   metadata (alt text, caption, copyright, focal point), backed by
   `AssetService.changeUid` — an asset-type-generic operation
   (`PATCH /projects/{projectKey}/assets/{uuid}/uid` on `AssetController`,
   not a media-only route) and each asset type's own existing update
   command. `folder-detail.component` (Pages store) already reuses the same
   `sf-uid-rename` widget. **Pages, Page/Section templates, both
   Navigation-store detail views (folders and references), and Media-store
   folders do not** — pages have no metadata sidebar at all, templates
   create-then-never-rename in one keystroke, navigation folders/references
   have no UID-rename UI despite the backend already supporting it
   generically, and Media folders (unlike Media files, which already have
   `media-detail-drawer.component`) have no detail view at all — only a raw
   `window.prompt` rename. Every store's folders, not just Pages', should
   reach the same bar. Close all of it.
2. **Creation UX.** Every "create a folder" flow in the app
   (`pages-list.component`, `media-library.component`,
   `navigation.component`) calls the browser's native `window.prompt(...)`
   for a name — no validation, no parent/type context, no visual polish, not
   even styled. Template creation (`templates.component.newTemplate`) has no
   dialog at all — it immediately creates a "New page template" placeholder
   the user must rename afterward. Only page creation
   (`pages-list.component`'s `openNewPage`/`newPageForm`) already has a real,
   in-house modal-like panel with a reactive form — but it's a one-off, not a
   shared component. Extract that into one professional, reusable "Create
   asset" dialog and use it everywhere an asset gets created.

## Exit criteria (epic is done when)

- [ ] A Page, a Page/Section Template, a Navigation folder, a Navigation
      reference, and a Media folder can each have their UID changed and
      their editable metadata (at minimum `displayName`; more per type as
      each one's existing update command already supports — see `M12.1`'s
      per-task notes) edited from the UI, with the same visual/interaction
      quality as `media-detail-drawer.component`. Every store's folders
      (Pages, Media, Navigation) reach the same metadata-editing bar — not
      just Pages', which already had it before this epic.
- [ ] There is exactly one shared "Create asset" dialog component, used for
      creating folders (Pages/Media/Navigation scopes), pages, page
      templates, section templates, and navigation references — no
      `window.prompt(...)` call remains anywhere in the asset-creation flow.
- [ ] The dialog adapts its fields to what it's creating (a folder only needs
      a name; a page needs a name + template; a navigation reference needs a
      name/label + target) without becoming a kitchen-sink form that shows
      irrelevant fields.
- [ ] Loading, validation, and error states on both the metadata editors and
      the creation dialog match the bar already set by
      `media-detail-drawer.component` and `project-settings-url-registry.component`
      — real UI, not silent failures or raw browser dialogs.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [asset-metadata-editing](01-asset-metadata-editing/README.md) | frontend | — |
| 2 | [create-asset-dialog](02-create-asset-dialog/README.md) | frontend | — |

Features 1 and 2 are independent of each other (different screens, no shared
new component between them beyond what already exists) and can be built in
parallel.

## Dependencies

Reuses `sf-uid-rename` (`ui/src/app/shared/components/sf-uid-rename.component.ts`),
`ApiClient.changeUid`/`AssetService.changeUid` (already generic, no backend
change expected), `DialogService` (`ui/src/app/core/ui/dialog.service.ts`,
today's confirm/message-only modal — feature 2 needs a form-hosting modal,
which is new, not an extension of `DialogService`'s existing shape; see
`02-create-asset-dialog/001-shared-create-dialog-component.md` for that
decision), and each asset type's existing create/update API
(`ApiClient.createFolder`/`createPage`, `TemplatesService.create`,
`NavigationService.createFolder`/`createReference`, or equivalents — confirm
exact method names per task, they may have drifted).

## Notes

- This epic is expected to be **almost entirely frontend** — the backend
  operations it depends on (`changeUid`, per-type create endpoints, per-type
  update endpoints) already exist and are already asset-type-generic where
  it matters. If a task's own investigation finds a real backend gap (e.g. a
  metadata field with no existing update path), note it plainly and treat it
  as new, explicit scope for that one task — don't assume the backend is
  complete without checking, and don't invent backend work that isn't
  actually needed.
- "Professional AAA-grade UI/UX" (the user's own words) means treating empty,
  loading, validation, and error states as first-class on every new/changed
  screen — the same bar `M10.3.3`'s import panel was held to.
