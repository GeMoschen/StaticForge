# Feature: Asset metadata editing

**Spec:** UI parity pass — extends the metadata-editing sidebar pattern
already shipped for Media (`media-detail-drawer.component`) and Pages-store
Folders (`folder-detail.component`) to every other asset type and folder
store that doesn't have it yet: Pages, Page/Section Templates, both
Navigation-store detail views, **and Media-store folders**, which — despite
Media's own *file* detail drawer already existing — currently have no
detail/edit view of their own at all, only a raw rename prompt.

## Goal

`AssetService.changeUid` (backend) is already asset-type-generic — it's
exposed on the plain `AssetController` (`PATCH
/projects/{projectKey}/assets/{uuid}/uid`), not a media-specific route — and
the frontend already has a reusable `sf-uid-rename` component wrapping it.
Only two of the six asset-detail surfaces that should have it
(Media files, Pages-store Folders) already do. Wire the same UID-rename
control, plus each type's own already-existing metadata/displayName update
path, into the remaining four: Pages, Templates, Navigation (folders +
references), and Media-store folders.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-page-metadata-editing.md](001-page-metadata-editing.md) | — |
| 2 | [002-template-metadata-editing.md](002-template-metadata-editing.md) | — |
| 3 | [003-navigation-metadata-editing.md](003-navigation-metadata-editing.md) | — |
| 4 | [004-media-folder-metadata-editing.md](004-media-folder-metadata-editing.md) | — |

All four tasks touch different, unrelated components and can be done in
parallel.

## Feature exit criteria

- [ ] `page-editor.component` can rename a page's UID and edit its
      `displayName`, with the same visual pattern as
      `media-detail-drawer.component`.
- [ ] `templates.component`'s template detail view can rename a template's
      UID and edit its `displayName` (and any other field its existing
      update command already supports).
- [ ] `nav-folder-detail.component` and `nav-reference-detail.component` can
      both rename their UID and edit their editable fields (a folder's
      `displayName`; a reference's `displayName`/label and target — check
      `CreatePageReferenceRequest`'s update counterpart for what's actually
      editable before assuming).
- [ ] A Media-store folder has a proper detail view (UID rename +
      `displayName` editing), replacing the raw `window.prompt`-based rename
      it has today — every store's folders (Pages, Media, Navigation) reach
      the same metadata-editing bar.

## Dependencies

`sf-uid-rename.component` (`ui/src/app/shared/components/`),
`ApiClient.changeUid`, and each type's existing update endpoint/service
method (`PageService`/`ApiClient.updatePage` or equivalent,
`TemplatesService.update`, `NavigationService`'s folder/reference update
methods, `ApiClient.createFolder`'s update counterpart for Media folders —
confirm exact names per task before use, this doc doesn't assume them).
`folder-detail.component` (Pages store) is the closest existing reference
for the new Media-folder detail view.
