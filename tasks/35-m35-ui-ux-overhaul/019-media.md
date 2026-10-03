---
id: M35.19
status: done
depends: [M35.11, M35.12, M35.13, M35.14, M35.15]
epic: m35-ui-ux-overhaul
feature: screens
area: frontend
---

# M35.19 — Media library and detail

## Context

`features/media/*` (library, folder and nav nodes, detail drawer, after M35.2). Screenshots 20–23 and E2. Folder cards
are clickable `<div>`s, checkboxes have no labels, delete is the only bulk action, there is no sort or list view, and
there is no upload progress.

## Goals

- **Tree:** folders only (the pane is titled "Folders", so files don't belong in it), via `sf-tree`, with a filter.
- **Main area:**
  - Toolbar: search, type filter, **sort** (name, date, size, type), **grid/list toggle** (stored in preferences),
    Upload (primary).
  - Grid cards: focusable, labelled checkboxes, name that truncates only at the end.
  - List view: `sf-data-table` with thumbnail, name, type, dimensions, size, modified, usages.
  - Selection bulk actions: move, delete (undo), download.
- **Upload:**
  - A drop zone visible on drag over the whole area.
  - A per-file progress list in a dockable panel: progress bar, cancel, retry, errors.
  - Alt text can be entered after upload.
- **Detail:**
  - A drawer (or split, resizable).
  - Tabs via `sf-tabs`: Details, Focal point, Versions, Used by.
  - A proper preview (fixes the collapsed thumbnail from M35.1).
  - Focal point set by clicking on the image; numeric fields only in developer mode.
  - Styled file replace.
  - Save enabled only when dirty.
  - Delete moved to ⋮ with confirm and undo.
- Selection in the URL (`?asset=` kept, not stripped).

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

**Signed off with M35.12 (gate decision 35):** drawers, the media detail included, start **below the top bar**; `sf-drawer`
is already offset by `--sf-topbar-height`. Do not re-open that question here.

## Acceptance criteria

- [x] Screen definition of done met (README).
- [x] Vitest specs updated. `npx vitest run` and `npx ng build` green.

## Notes (M35.9)

- Decide first (open from the gate): whether `sf-drawer` starts below the dark top bar. The media detail showed it
  covering the bar.
- The signed-off sample (decisions 19-22) is the reference. The detail is a resizable, non-modal `sf-drawer` on the
  right, with ←/→ to step to the previous/next file. It **widens the tab list in Goals** (Details, Focal
  point, Versions, Used by) with all tabs, shown only when they apply to the file: Details (large preview, alt text,
  caption, file info, styled Replace, focal point set by clicking the preview, numbers in developer mode), Variants,
  Languages (a file per language), Processing (the "Process CMS syntax" switch of text media with its diagnostics),
  Rendered (served output of text media), Source (text media in the code panel), Used by, Versions. Check backend
  support for Variants, Languages, Processing and Rendered before building each tab.
- Grid card: thumbnail with the name (truncated at the end) and "JPG · 1.2 MB" below, checkbox top-left on
  hover/focus/selected, status icon when unreleased. A drop zone covers the whole area; the upload progress panel is
  per file. Bulk move, delete (undo) and download.

## Notes (M35.15 favorites)

- The media tree and the grid and list: add the pinned *Favorites* node (`pinned: true`, only while there are favorites; children from
  `FavoritesService`, flat with an icon per kind, favorite folders as lazily loaded folder nodes, a click on the node opens
  the Favorites list in the main pane) and *Add to / Remove from favorites* to the row context menu (and a hover/focus ☆
  in table name cells). The design is in the sample (`/styleguide/sample`, gate round 5, decisions 57–58). Favorites are
  not store-bound: the node lists them from every store.
- Put the open item in the URL (`?asset=` / `?folder=`, or the route's UUID) so it is recorded as a recent.

## Design sign-off (2026-10-03)

The sample was extended (gate **review round 9**, decisions 90–106) and **signed off by the user on 2026-10-03**: tree filter, review
states, per-file menu / rename / move dialogs, download, URL state (`q`, `type`, `sort`), unsaved-changes guard in the drawer, uploads
panel (error reasons, inline alt text), typed delete from 25 files, keyboard sheet, focal point for JPG only, and the text-media Source
tab (name completion, SVG completion, highlight override, banners, language select). Favorites follow decisions 57–58 (Pages pattern).

## Implementation plan (M35.19)

Reference for every step: the sample in `features/styleguide/sample/media/` (components, state, specs) and `009` round 9.

- [x] **A. Foundation:** `MediaLibraryStore` rework (folder list, search/type/sort in the URL, selection, view mode in preferences),
      shell, `sf-tree` folders-only with filter, toolbar, grid (roving focus, labelled checkboxes), list (`sf-data-table`), states
      (skeleton, error, empty), route query params (`asset`, `folder`, `media`, `q`, `type`, `sort`, `mtab`).
- [x] **B. Actions:** per-file/folder menus, rename and move dialogs, bulk move/delete (undo, typed delete from 25), download,
      favorites (pinned node, star, Favorites list), drag onto tree folders.
- [x] **C. Uploads:** drop zone, docked panel with per-file progress/cancel/retry/error reasons, inline alt text.
- [x] **D. Detail drawer:** `sf-drawer` + `sf-tabs`, details/focal point/replace, variants, languages, processing, rendered, source,
      used by, versions, ←/→ stepping, unsaved-changes guard, delete in ⋮ with undo.
- [x] **E. Finish:** `?` sheet shortcuts, i18n, remove the old components, specs, `npx vitest run`, `npx ng build`, `npm run lint`,
      Chrome check (light/dark, compact/comfortable, 1440/1024), review section below.

### Phase A notes (done 2026-10-03)

What is in the app now (all under `features/media/`):

- **Store** (`library/media-library.store.ts`): the URL is the source of truth. `applyRoute({folder, asset, q, type, sort, media})` takes the
  route's query parameters (inputs of `MediaLibraryComponent`); every change goes back through the router (`openFolder`, `openAsset`,
  `setSearch` (debounced, replaces the entry), `setTypeFilter`, `setSort`, `setView`, `clearFilters`), so back/forward and deep links work.
  `?asset=` and `?folder=` are kept; a stale one is dropped with a toast (`forgetFolder`/`forgetAsset`); an `asset` of another folder brings
  its folder along. `visible()` is the open folder's files after search, type filter and sort (client-side: the backend has no sort/filter),
  `shown()` the grid's chunk (60, more as the end scrolls in), `selected`/`selectedItems()` the selection (toggle, range, `selectAll`,
  pruned when a filter hides files). The view is `viewParam() ?? preferences.mediaView()`; `setView` stores the preference (new typed key
  `mediaView`) and rewrites a `?media=` that would override it. The folder is read page by page (`PAGE_SIZE` 200) until complete.
  Kept for the actions and the drawer: `items`, `selected`, `allMedia`, `selectedMedia`, `reloadMedia`, `reloadFolders`, `onUpdated`,
  `onDiscarded`, `onDeleted`, `prepend(media, folderUuid)`, `labelOf`, `parentFolderUuidOf`, `mediaByFolder`, `connect`.
- **Shell** (`media-library.component.*`): `sf-splitter` (`paneId="media-tree"`) with `sf-media-library-tree` and `sf-media-library-main`;
  the frame's breadcrumb (*Media › folders*, each ancestor a link) comes from `useFrameItem`; one `h1` in the main pane's `sf-page-header`
  (the folder's name; *All media* at the root) with the folder's ⋮ menu (Rename folder F2, Move folder…, Delete folder…).
- **Tree** (`library/media-library-tree.component.*`): `sf-tree`, folders only, `treeId="media"`, file-count badge, UID as secondary text in
  developer mode, own filter field under the head (decision 90, not in the URL) with no-match state and *Clear filter*, skeleton, error
  with Retry, "No folders yet". Create and rename are inline; delete asks and offers Undo through `MediaFolderActions`; folders move by
  drag, cut/paste or *Move to…* (the Pages `FolderMoveDialog`, which got a `rootLabel` input).
- **Grid, list, toolbar, states, drop zone**: `media-library-grid` (role=grid, roving tabindex, arrows/Home/End/Space/Enter/Ctrl+A, F2 and
  Delete wired to the existing item actions, right click / Shift+F10 open the existing context menu), `media-library-list`
  (`sf-data-table`, `tableId="media-list"`, `currentKey`, selection shared with the grid), `media-library-toolbar`, `media-library-main`
  (bulk bar, skeleton, error + Retry, empty folder, nothing matches + *Clear filters*, empty library, drop zone over the whole area, docked
  upload list), `media-preview` (thumbnail of rasters, first lines of small text files, else an icon). The old sidebar, folder node, nav
  node, folder detail drawer, grid and toolbar are gone.
- **i18n**: real keys are `media.*` in `en.json` (`folders`, `toolbar`, `library`, `grid`, `list`, `empty`, `bulk`, `dropzone`, `uploads`);
  the sample keeps its own `styleguide.sample.media.*`.

**Backend** (reported, tested): `MediaSummaryView` gained `width`, `height`, `changedAt` and `usageCount` (list view columns Dimensions,
Modified, Used by). `usageCount` is one grouped query for the page (`AssetReferenceRepository.countIncomingOpen`, `AssetService.usageCounts`,
`MediaService.usageCounts`); `schema.d.ts` edited by hand like the other generated types. Test:
`RevisionAwareReferencesIntegrationTest.theMediaListCarriesTheUsageCountAndWhenTheFileChanged`.

**Deviations (and why):**

- Sorting and filtering are client-side: the list endpoint has no sort or filter parameter, so a folder is read completely (200 per request)
  and the grid renders it in chunks (the list virtualises its rows) — a sort over only the loaded pages would be wrong.
- The list view's header sort sorts the table on its own; the toolbar's sort decides the order the rows arrive in (as in the sample).
- The tree's folder moves use the Pages move dialog with the library root's name, until phase B builds the sample's own move dialog.
- A back/forward step that changes `asset` cannot ask about unsaved drawer edits (the router already moved); clicks, ←/→ and the close button
  still ask (`canLeaveDetail`). Phase D's guard should cover it.
- `ApiClient.listMedia` and `mediaThumbnailBlob` no longer raise the global error toast: the library shows its own error state, and a card
  without a thumbnail shows its icon.

**For phase B** (actions): per-card ⋮ menu and the context menu already exist as `MediaItemActions.onItemContextMenu(item, target)` (old
English strings, to be replaced by the sample's file menu); `renamingItem` opens the old rename dialog; `deleteFile(file)` /
`deleteSelection()` / `deleteMedia(...)` do the delete with Undo. Bulk bar and list bulk bar show Delete only (add Move, Download in
`media-library-main.component.html` and `media-library-list.component.ts`). Folder actions live in `MediaFolderActions`
(`createFolder`, `renameFolderTo`, `moveFolders`, `requestMove`, `deleteFolder`, `treeRequest`). Drag of cards onto tree folders and the
Favorites node are not built: the tree's `rootDroppable` and `canDrop`/`menuItems` inputs are free to use. **For phase C**: the upload
store still uploads into `library.folderUuid()` (captured per batch) and `MediaLibraryUploadsComponent` is a minimal docked list with
`media.uploads.*` keys. **For phase D**: the drawer is untouched and still modal; `store.selectedMedia` is set from the URL's `asset`
(`resolveAsset`), `closeDetail()` is what its `closed` output calls.

**Open items:** the `?` sheet lists no media shortcuts yet (E); only `folder.rename` (F2) is registered. Chrome check at 390 and compact vs
comfortable not done (1440 and 1024, light and dark, were reviewed). The m6/m16/m18/m22/m29 journeys' card selectors were moved to the new
grid but the journeys were not run (they need `SF_RUN_E2E`).

### Phase B notes (done 2026-10-03)

What is in the app now:

- **One file menu** (`MediaItemActions.menuItems(file)`, decision 92): *Open, Rename…, Move…, Download, Copy link, Add to / Remove from favorites, Delete…*
  (danger, after a separator, shortcuts shown). It is the ⋮ `sf-menu` on a grid card (shown on hover and focus, `visibility: hidden` otherwise, so
  no tab stop) and in the list's new ⋮ column, and the context menu of a card or row (right click, Shift+F10 / menu key). On a file that is part of a
  multi-file selection it acts on the selection (*Move N files…, Download N files as ZIP, Delete N files…*). F2 renames and Delete deletes (the
  selection when the file is in it) in the grid and the list. Copy link copies `/p/<key>/media?asset=<uuid>` (the app link, like the Pages screens).
- **Rename dialog** (`media-rename-dialog.component.ts`, rules in `media-file-name.util.ts`): required, none of `/ \ : * ? " < > |`, at most 100,
  the extension stays, not taken in the folder, Apply disabled until valid and changed, Enter applies. `renameMedia` keeps its signature (Undo
  renames back with the revision the rename produced) and tells the store (`onRenamed`: grid, project list and an open drawer get the new name and revision).
- **Move** (`MediaMover`, `media-move-dialog.component.ts`): one dialog for bulk Move, a file's *Move…*, the page header's *Move folder…* and the tree's
  *Move to…*; `moveTo(uuids, target, kind)` is the one place that calls `POST /assets/{uuid}/move`, with **one Undo for the group** (moves everything back
  to where it came from, last to first, then re-reads). The Pages `FolderMoveDialog` is no longer used by media (its `rootLabel` input from phase A stays).
- **Bulk bar** (grid) and the table's bulk bar (list): Move, Download, Delete (danger), Clear selection. Delete: plain confirm with the names below 25
  (Undo as a group through `UndoService.offerGroup`), the typed word `delete` from 25 (`typeToConfirmFor`). The confirmation adds what uses the files
  (`usageCount`) and the "stays online" note.
- **Download** (decision 95): one file → `mediaBinaryBlob` saved under the name the library shows; several → `POST /media/download` and one ZIP named
  after the folder (`products.zip`; `all-media.zip` at the root). 413 and other errors are toasted.
- **Drag and drop**: cards are `draggable` (the selection when the card is part of it); `sf-tree` got `acceptForeignDrag` (input) and `foreignDrop`
  (output) for drags that did not start in the tree (spec in `sf-tree.component.spec.ts`), the API is otherwise unchanged. The folder the files are in
  refuses (red), the top level takes them (`rootDroppable`), Favorites nodes are not droppable. A drop is a Move with Undo.
- **Favorites** (decisions 57–58, 60): pinned *Favorites* node (only while there are favorites and no folder filter) with the favorites of every store as
  flat shortcuts (kind icon + location), favorite folders expand lazily (`FavoriteTreeService`), a click on the node opens `?favorites=1` (the shared
  `sf-favorites-view` in the main pane, the toolbar and folder header give way), a click on a shortcut opens it in its own area. *Add to / Remove from
  favorites* is in the file menus and the folders' tree menu (toast), the list's name cell has the hover/focus star (`sf-asset-favorite`, warning
  colour while favorite). Nothing in the branch can be renamed, moved or deleted.
- **Tree selection follows the store**: the tree's `selection` is two-way (`[(selection)]` on a signal that an effect keeps equal to the URL); when
  `openFolder`/`openFavorites` return `false` (the drawer's leave guard said no) the tree puts the selection back (a *copy* of the array — a binding
  that gets the same reference twice does not reach the tree).
- **Who may change things**: `MediaLibraryStore.canEdit` = editor or better **and** not read-only (`ProjectPermissionsStore.canEditContent`); a viewer
  and a past revision get no Rename, Move, Delete, drag, folder change or bulk Move/Delete, but Open, Download, Copy link and the favorite star. All
  guards of the library (items, folders, mover, tree, grid, list, main) use it instead of `readOnly()`; `MediaUploadStore.canUpload` is the same rule.
- i18n: `media.menu`, `media.rename`, `media.move`, `media.delete`, `media.download`, `media.bulk`, `media.folders.favorites`,
  `media.list.columns.actions`; the old English literals in `media-item-actions.ts` are gone, five `media.folders.move*` keys that nothing reads were dropped.

**Backend** (tested, only the affected Gradle tests were run): `POST /api/v1/projects/{key}/media/download` (`MediaController.download`, body
`MediaDownloadRequest {uuids, name}`): VIEWER, 1–500 distinct files, at most 100 MB uncompressed (built in memory; 413 `SF-MEDIA-0413`), entries named
as the library shows them (`displayName`, a taken name gets `-2` before the extension, compared without case), ZIP named `<name>.zip` with unsafe
characters replaced (`media.zip` without a name). `schema.d.ts` edited by hand (`MediaDownloadRequest`, the path, `download`), `ApiClient.downloadMediaZip`,
`docs/api.md` and the specification's media table. Tests: `MediaDownloadIntegrationTest` (ZIP with own names and numbering, viewer allowed, one file once,
no name → `media.zip`, empty list 400, unknown file 404, no session 401); `RevisionAwareReferencesIntegrationTest` and `LocalizedMediaIntegrationTest` still green.

**Deviations (and why):**

- The Move dialog offers the top level (*All media*) for **files** too (the sample offers it for folders only): files can live at the library root.
- Only grid cards are draggable; list rows are not (`sf-data-table` has no row drag). The list has the ⋮ column, the menu and the bulk bar.
- In the Favorites view the upload drop zone of the main pane is still active (phase C's handlers sit on the pane); a drop there uploads to the library root.
- The ⋮ column is a normal table column (`actions`, not hideable) and the name column is 200 px wide so that all columns fit next to a 280 px tree at 1440;
  narrower panes scroll the table sideways.
- `Delete` in the shortcut hint of a menu item renders as `Del` (the shared `sf-kbd`).

**Verified in the browser** (headless Chromium against a scratch backend, 1440 and 1024, light and dark; screenshots reviewed): ⋮ button and menus
(card, selection, row, tree), F2 dialog with each error, move dialog with the current folder disabled, bulk Move/Download/Delete bar, typed delete for
30 files, Undo of rename and move, a card and a whole selection dragged onto a folder and onto the tree root, the own folder refusing, single download
(`cold-brew.png`) and ZIP (`products.zip` with both files), Favorites node/list/stars.

**Open items / for C, D, E:**

- **Specs that fail today because of phase D's `mtab` (not B):** `navigate()` in the store adds `mtab: null` whenever `asset` is cleared; seven
  expectations in `media-library.store.spec.ts` (3) and `media-library.component.spec.ts` (4) still say `{ asset: null }` / `{ folder: …, asset: null }`.
- **The "Unhandled Errors" header** of the multi-folder run comes from `media/media-localized.spec.ts` (phase D's drawer): its stores read
  `assetHistory` as an array (`media-drawer-versions.store.ts`: `(entries ?? []) is not iterable`) and its `PreferencesService` mock has no `setRecents`
  (`RecentsService.apply`). Nothing in `media/library`, `shared`, `core`, `pages` or `favorites` causes it.
- E: the `?` sheet lists no media shortcuts yet (Enter, F2, Delete, Shift+F10 on a card or row; the Favorites node); only `folder.rename` is registered.
  The m6/m16/m18/m22/m29 journeys were not run (need `SF_RUN_E2E`); the journeys' selectors for cards and the delete confirm were moved in phase A.
- D: the drawer's ⋮ menu should reuse `MediaItemActions.rename`/`MediaMover.moveFiles`/`download`/`copyLink` (they take a summary or a full `MediaView`);
  `MediaLibraryStore.onRenamed` keeps the open drawer's name and revision current after a rename from the library; a move of the open file closes the
  drawer (`onDeleted`), with the drawer's own leave guard not consulted.
- C: nothing to do; `canUpload` and `canEdit` are the same rule.

### Phase C notes (done 2026-10-03)

Files (all under `features/media/library/` unless noted):

- `media-upload.store.ts` (rewritten): `MediaUploadStore` checks files before sending (type against the project's effective allow-list,
  size against the server's cap, a name that is taken in the target folder or earlier in the same drop), then sends them through
  `UPLOAD_CONCURRENCY` (3) parallel requests, each into the folder that was open at drop time (captured with its label). State per row:
  `queued | uploading | done | error`; Cancel unsubscribes (aborts the XHR); Retry (lost connection only), `resolveDuplicate`
  (`'replaced'` = `POST /media/{uuid}/replace` on the file that has the name, `'copy'` = `name-2.ext` via `nextFreeName`), `saveAlt`
  (`PUT /media/{uuid}` with `If-Match` = the upload's revision, `?locale=` = the editing locale, body `{altText, focalPoint}` — the same
  call as the drawer's metadata store), `clear()` (the panel's Close). Finished files go in with `library.prepend(media, folderUuid)`
  (grid/list and the tree's folder count follow at once); a Replace calls `library.onUpdated`. Drag handling: depth counter, only
  `dataTransfer.types` containing `Files`, `dropEffect` copy (none for a viewer); document-level `dragover`/`drop` guards stop the browser
  from opening a file dropped beside the library (it would navigate away and lose the in-memory token); `canUpload` =
  `ProjectPermissionsStore.canEditContent()` (editor+, not read-only), `blockedReason` for the notice beside Upload.
- `media-upload.util.ts` (+ spec): `nextFreeName`, `mimeAllowed`, `uploadFailure` (HTTP status to reason), `acceptsAlt`.
- `media-library-uploads.component.*` (rewritten, + spec): the docked panel from the sample (header "Uploads to {folder}" / "to N folders",
  polite summary "2 of 4 uploading" / "All uploads finished" / "1 upload failed", collapse with `aria-expanded`/`aria-controls`, Close only
  when nothing runs, per file icon, name, size, `role=progressbar` + %, Cancel/Remove, inline alt field + Save, Open details, error text
  and the buttons that fit the reason). The host is `position: fixed` in the window's bottom right corner (a library narrowed by the open drawer, or hidden
  behind it at 1024 px, would clip an absolute panel) and shifts left by the open drawer's width + 16 px: it measures the `sf-drawer`
  panel in the DOM (`ResizeObserver`), so it needs no wiring from phase D and follows resizing.
- `core/api/api.client.ts`: `uploadMediaWithProgress` and `replaceMediaWithProgress` (`observe: 'events'`, `reportProgress`, no global error
  toast) returning `Transfer<T>` (`progress | done`); `uploadMedia`/`replaceMedia` unchanged. Spec: `core/api/api.client.upload.spec.ts`.
- Small edits elsewhere: `media-library-main.component.html/.ts` (drop handlers incl. `dragover`; `sfDropTarget` removed — it forced
  `dropEffect = copy` on every drag, including the cards' own; Upload/empty-state buttons use `uploads.canUpload()`),
  `media-library-toolbar.component.html` (Upload disabled + reason via `uploads`), `media-library.store.ts` (`onUpdated` only sets
  `selectedMedia` when the URL names that file or it is the open one — the panel's alt save must not open the drawer),
  `media-library.testing.ts` (`projectStub.project`), `media-library.component.spec.ts` (editor permissions stub, drop zone block).
- i18n: `media.uploads.*` in `en.json` (the old `uploading/done/failed` keys are gone).

**Backend (small, NOT run through Gradle):** `ProjectDetail` gained `effectiveAllowedMimeTypes` (the project's override, else
`sf.media.allowed-mime`) and `mediaMaxUploadBytes` (`sf.media.max-upload-size`, default 100 MB), filled in `ProjectController.toDetail`
(which now takes `MediaProperties`); `schema.d.ts` edited by hand (both optional). The sample's "10 MB / images, PDF, CSS, SVG" is
only the sample: the real server accepts every type (`*`) and 100 MB by default, so the panel reads both from the project detail and
leaves the decision to the server when they are missing. To test: `GET /api/v1/projects/{key}` returns `effectiveAllowedMimeTypes: ["*"]`
(or the project's list) and `mediaMaxUploadBytes: 104857600`; compile `sf-api` (constructor of `ProjectController`).

**Deviations (and why):**

- *Replace* is `POST /media/{uuid}/replace` on the file that has the name; the file keeps its alt text, so the panel does not ask for one
  after a Replace. *Keep both* uploads under `name-2.ext`; the server itself never refuses a duplicate name (it derives a unique UID).
- Per-file `POST /media` (not `/media/bulk`): bulk gives no per-file progress or cancel.
- Retry exists only for a lost connection (decision 98); a server problem (5xx included) shows the server's message and Remove.
- A 413/415 that slips past the client check is shown as the size/type message (the limit is named when the project detail has it).
- Leaving the media screen aborts uploads that are still running (the store lives with the screen).

**Browser check (headless Chromium, 1440 and 1024, light and dark, scratch backend 8083 + ng serve 4303):** picker with five files (two
pictures uploaded, a duplicate, a refused type, an oversized file), Keep both, alt text typed and saved, slow upload at 250 KB/s with
live %, Cancel (request aborted, file never appears), drop overlay over the Team folder with a simulated `DragEvent` carrying a file,
the drop (panel header "Uploads to 2 folders"), the panel beside the open drawer (right edge 16 px left of the drawer). The running
backend jar predates the new project-detail fields, so the check injected them by intercepting `GET /projects/{key}` (limit 3 MB,
`image/*`, `text/css`); `PATCH /me/preferences` answers 500 on that old jar (phase A's `mediaView` key) and is unrelated. Not done: 390 px,
real OS file drag (Playwright cannot start one), Replace against the real server.

**Open items / for B, D, E:** B: `MediaUploadStore.canUpload` is the upload rule (editor+, writable); `library.readOnly()` alone does not cover
viewers. D: the panel measures `body > sf-drawer:not(.sf-drawer-host--modal) > .sf-drawer`; keep that structure (or tell me); a replace in the
drawer is independent of the panel. E: the `?` sheet has no upload shortcut (Upload is a button); run the m6/m16/m18/m22/m29 journeys (they
upload through the toolbar's file input, which is unchanged); unit specs of `media-library.component.spec.ts` fail today for `mtab` and the
drawer's JIT template — phase D's work in progress, not the upload code.

### Phase D notes (done 2026-10-03)

What is in the app now (`features/media/`):

- **Shell** (`media-detail-drawer.component.*`): `sf-drawer` (non-modal, below the top bar, width kept in the root-provided `MediaDrawerLayout`
  for the session) with the file name as title; header actions: unreleased status chip (`store.status`), favorite star, Previous/Next
  (`aria-keyshortcuts`, ←/→ only while focus is in the header, no modifier, wraps), ⋮ menu (Replace…, Rename… F2, Move…, Download, Copy link,
  Delete… danger and separated; without write rights only Download and Copy link). Meta line "JPG · 4000 × 2667 · 1.2 MB" and "i of n", the
  `sf-release-bar` (release flow unchanged), `sf-tabs` (label "File details"; dirty dot on Details/Source, the usage count on Used by), the
  tab panel, and on Details and Source the footer: `sf-save-status`, Revert (ghost, only while dirty), Save (disabled with a reason: nothing
  to save / read-only / errors in the source). Inputs: `projectKey`, `media` (a list row or a full view), `tab`, `position`, `folderPath`,
  `mediaUids`; outputs: `closed`, `updated`, `deleted`, `discarded`, `tabChange`, `step`, `fileAction` (`rename|move|download|copyLink`).
- **The drawer reads the file itself** (`MediaDrawerStore.loadDetail` → `GET /media/{uuid}`, at the viewed revision in time travel): a list
  row carries no alt text, caption, focal point, variants or language files (the old drawer could not show them for a file opened from the
  grid). A skeleton stands in until it is read; a failed read has Retry; a newer revision of the open file reads again.
- **Library wiring** (small edits in phase A files): `MediaLibraryStore` got `tabParam`/`setDetailTab` (`?mtab=`, a replaced entry; closing
  the drawer drops it), `detailPosition`, `stepAsset(±1)` (wraps, over the visible sorted list), `assetFolderPath`, `mediaUids`;
  `MediaLibraryComponent` has the `mtab` input, binds the drawer and handles `fileAction` with the item actions' `rename`, `download`,
  `copyLink` and `MediaMover.moveFiles` (the same dialogs as the grid's menu). Delete stays in the drawer (below).
- **Unsaved changes (decisions 48, 97):** the drawer is an editor of its own (`ActiveEditorService.register`): Ctrl+S saves it, `beforeunload`
  asks, and the new route guard `mediaLeaveGuard` (`media-leave.guard.ts`, `runGuardsAndResolvers: 'always'` on the media route) asks
  Save / Discard / Cancel whenever `?asset=` changes or the screen is left — stepping, a click on another file, closing, another folder,
  the rail, **and the browser's back/forward** (the router restores the URL on Cancel). Search, sort, view, drawer tab and the folder of the
  open file pass. `MediaLibraryStore.canLeaveDetail` is therefore unused by the shell (E: delete it with its spec).
- **Stores** (`drawer/`): `MediaDrawerStore` (file, revision, tabs, tab fallback, status), `MediaDrawerMetadataStore` (signals instead of a
  `FormGroup`: dirty = differs from the server; a reload or a save never overwrites newer edits — specs for both), `MediaDrawerTextStore`
  (source with live validation, conflict keep-mine/take-theirs, Processing findings, Rendered), `MediaDrawerFilesStore` (Replace, files per
  language, thumbnails), `MediaDrawerUsagesStore` (usages, delete with confirmation and Undo), `MediaDrawerVersionsStore` (history, Restore),
  `MediaDrawerNamesStore` (completion names), `MediaDrawerPreviewStore`.
- **Tabs:** Details (`media-drawer-details`: preview that keeps its aspect and never collapses — SVG/PNG on a checkerboard, text files as a
  read-only highlighted `sf-code-editor`, PDFs and the rest as icon + name; focal point for JPEG only, click / arrows 1 % / Shift 10 %,
  live "Focal point x % × y %", numeric X/Y in developer mode; alt text of images and SVG and caption per editing language; copyright; the
  File list; styled Replace with an accept filter; developer facts UID, path, media type, SHA-256, storage path), Variants, Languages
  (`media-drawer-localization`), Processing (`media-drawer-process`), Rendered, Source, Used by (list with links + the old
  `sf-asset-impact` and `sf-asset-urls` below it), Versions.
- **Source:** `sf-code-panel` with `svg`, `names` (global values as `CMS_GLOBAL.<set>.<path>` from the sets' content, `media:<uid>` from
  the library's project-wide list, `page:<uid>` from the pages), the *Highlighted as …* menu (writes `PUT /projects/{key}/code-highlighting`
  by extension, keeping the other overrides; disabled with a reason without project-admin rights or without an extension), banners (too
  large, not UTF-8, mixed line endings), a Language select for a file per language that asks before dropping edits.
- **Deleted:** `media-drawer-metadata.*`, `media-drawer-preview.*` components, `_drawer-parts.scss`, the old modal shell. Baselines for
  the drawer's files were removed from `i18n-literals.baseline.json` and `tokens.baseline.json`.
- **i18n:** `media.drawer.*` in `en.json` (added by script). **Specs:** `media-detail-drawer.component.spec.ts` (header, tabs, Details, focal
  point, menu, stepping, guard, delete, Replace, time travel), `media-localized.spec.ts`, `drawer/media-drawer-source.spec.ts`,
  `drawer/media-drawer-tabs.spec.ts`, `media-leave.guard.spec.ts`, `library/media-library.store.detail.spec.ts`; `media-undo.spec.ts` kept
  (connect signature); a completion spec for `CMS_GLOBAL.` in `shared/code-editor/completions.spec.ts`.

**Deviations (and why):**

- The completion names use the project's real syntax, not the sample's: `CMS_GLOBAL.<set>.<path>` (not `#global.…`) and `page:<uid>` (not
  `page:/path`) — `REFERENCE_START` in `shared/code-editor/completions.ts` now also matches `CMS_GLOBAL.…` as one name.
- *Copyright* (old drawer) is kept as a field under Caption although the sample has none; dropping it would lose a function.
- Alt text is no longer "required" on save (the old form blocked a save without it, which also blocked a caption on a PDF); the server
  decides at release.
- Delete is the drawer's own (`MediaDrawerUsagesStore`): it reads the usages afresh and lists them in the confirmation; the old typed
  `DELETE` for a used file is gone (decision 50: the typed word is for 25 files or more). Undo restores the revision shown.
- Copy link is the library's (`…/media?asset=<uuid>` deep link), as the grid's menu.
- The Processing tab's "last attempt" is the answer of the switch (warnings / 422 diagnostics) while the drawer is open, else the saved
  text checked now through `POST text/validate` — the backend keeps no record of an attempt.
- PDF preview is the icon with the file name (no first page: there is no PDF renderer in the app).
- The header chip and the release bar both say "New" for an unreleased file (the bar stays for Release…/Schedule… and the per-language
  list); E may hide the bar's own status in the drawer.

**Backend gaps per tab (reported, nothing faked):** Details — no uploaded-by/when or modified fields on `MediaView`: read from the asset
history (first and newest entry); no storage path: derived `blobs/aa/bb/<sha>` (the filesystem store's layout, S3 may differ); the list row
has no `image`/`variants`/`altText` (hence the detail read). Variants — `MediaVariantView` has name, width and format only: height follows
the original's aspect, no size. Languages — complete (`localeFiles`, `PUT localized`, `files/{locale}`). Processing — no stored attempt (see
above). Rendered — `binary?rendered=true`, no locale parameter. Source — complete. Used by — complete (`assetUsages`). Versions — history only
lists revision, name, who and when (no size or note). No backend change was made in phase D.

**Browser check (headless Chromium, scratch jar backend 8084 + ng serve 4304, 1440 light and 1024 dark):** JPG, PNG, SVG, CSS, PDF and a
localized PNG open; every tab; focal click; alt edit, ←/→ in the header with the leave dialog (Cancel keeps the file and the edit, Save steps
after saving), browser back with an edit raises the dialog; Source completion (`media:` names), a refused switch-on shows the 422 findings
and leaves the switch off; Replace from the ⋮ menu focuses the drop zone and swaps the file; delete from the ⋮ menu closes the drawer and Undo
brings the file back; the tab stays when stepping. `GET /me/preferences` answers 500 on that old jar and the Used by tab's URLs panel
(`sf-asset-urls`, unchanged) fails on a project without output — both unrelated.

**Open items / for E:** remove `MediaLibraryStore.canLeaveDetail` and its spec cases; the `?` sheet needs the drawer's shortcuts (←/→ in the
header, focal arrows, Esc); `sf-asset-impact`/`sf-asset-urls` still use old tokens and English text (baselined, not part of D); run the
m6/m16/m18/m22/m29 journeys (their drawer selectors — old tabs, "Save metadata", `input[type=file]` replace — need updating: the Save
button is now "Save" in the footer and Replace is an `sf-file-drop`); Chrome check at 390 px and compact/comfortable not done; the stepping
buttons are disabled in a folder of one file.

### Phase E notes (done 2026-10-03)

Hand-over items closed: `MediaLibraryStore.canLeaveDetail` is gone (the route guard decides; `openFolder` / `openFavorites` / `openAsset` now return a
`Promise<boolean>` that is `false` when the guard refused, and the tree puts its selection back then); the seven `mtab` expectations were already
current; the `Unhandled Errors` of `media-localized.spec.ts` / `media-drawer-source.spec.ts` were the specs flushing `{}` to the history read (the store
rightly expects an array): they now settle pending reads with `flushPending` in `drawer/media-drawer.testing.ts`; the command-palette mock got
`setRecents` / `setFavorites`; the drawer's header "New" chip is gone (the release bar keeps the one status).

## Review (2026-10-03)

Design signed off in the sample first (gate round 9, decisions 90-106, plus rounds 1-2 and 5). Built as signed off; deviations below.

- **Library shell** (`features/media/`, `library/`): `sf-tree` of folders only with its own filter, toolbar (search, type, sort, Grid/List, Upload), grid
  (roving focus, labelled checkboxes, range/all selection) and list (`sf-data-table`), skeleton / error with Retry / empty folder / nothing matches / empty
  library, drop zone over the whole area, docked uploads panel. Search, type, sort, view, folder, file and drawer tab live in the URL (`q`, `type`,
  `sort`, `media`, `folder`, `asset`, `mtab`, `favorites`); back/forward and deep links work.
- **Actions:** one file menu (card, row, context menu, drawer), rename dialog with live rules, move dialog and drag onto tree folders (one Undo per
  group), bulk Move / Download (ZIP) / Delete (typed word from 25), favorites (pinned node, list, star), who-may-change rules (`canEdit`).
- **Uploads:** per-file progress, cancel, retry (lost connection only), type/size/name checks against the project's rules, Replace / Keep both, inline alt text.
- **Drawer:** `sf-drawer` + `sf-tabs` (Details, Variants, Languages, Processing, Rendered, Source, Used by, Versions), focal point for photos, styled Replace,
  Save/Revert/status footer, unsaved-changes guard (stepping, closing, another folder, rail, browser back), source editor in the code panel with name
  completion, highlight override, banners and language select, delete with Undo.
- **Phase E:** all media keys on the `?` sheet (`mediaShortcuts`, `mediaDrawerShortcuts`, `mediaFocalShortcuts` in `core/ui/documented-shortcuts.ts`; groups
  *Media files*, *File details*, *Focal point*) and *Upload files* / *Show the favorites* in the palette; `sf-asset-impact` and `sf-asset-urls` on tokens and
  Transloco, `sf-asset-urls` shows a quiet note with Retry instead of an error toast when the registry cannot be read; user guide, API doc and the
  specification's project table updated.
- **Defects found in the browser review and fixed at the root:**
  - *Shared `sf-context-menu`:* a right click while another context menu was open threw `insertBefore ... not a child` in the console (the panel moves
    itself into `<body>` and was the repeated view's first node); each panel now sits in a slot that stays in place (a spec reproduces it).
  - *Keyboard:* the media toolbar was a roving `sf-toolbar` whose first item is the search field, which keeps the arrow keys, so Type, Sort, Grid/List and
    Upload could not be reached by keyboard at all; `sf-toolbar` got `roving="false"` (a plain named group, every control a tab stop) and the media toolbar
    uses it.
  - *List view:* the Name column collapsed to nothing at 1024 and truncated names at 1440 (all columns now fit a 1440 pane; narrower panes scroll sideways).
  - *Loading:* the toolbar jumped 22 px when the files arrived (the count line is reserved while loading and on error).
  - *Favorites list* had its padding doubled inside the library and did not line up with a folder's title.
  - *Tests:* the full vitest run ended with two `Worker terminated due to reaching memory limit` unhandled errors (jsdom windows leaking into long-lived
    workers); `vitest.config.mts` now sets `pool: 'forks'` (heap per file stays below 1 GB).
- **Backend (phases B-C):** `MediaSummaryView` carries `width`, `height`, `changedAt`, `usageCount` (one grouped query per page); `POST /media/download` (ZIP);
  `GET /projects/{key}` carries `effectiveAllowedMimeTypes` and `mediaMaxUploadBytes` (new `ProjectDetailMediaLimitsApiTest`).
- **Deviations:**
  - Completion names use the project's real syntax (`CMS_GLOBAL.<set>.<path>`, `media:<uid>`, `page:<uid>`), not the sample's `#global...` / `page:/path`.
  - *Copyright* stays as a field under Caption (the sample has none); alt text is not required to save (the server decides at release).
  - PDF preview is an icon with the file name (no PDF renderer); text media cards show the first lines as a plain snippet.
  - List rows are not draggable (`sf-data-table` has no row drag); cards are.
  - Details *uploaded by / modified* come from the asset history (first and newest entry) because `MediaView` has no such fields; the storage path is derived
    (`blobs/aa/bb/<sha>`, the filesystem store's layout); Variants shows no height or size (the API has none); Processing's "last attempt" is the answer of the
    switch while open, else a validation of the saved text (the backend keeps no record).
  - `Delete` shows as `Del` in menu shortcut hints (shared `sf-kbd`); right-clicking a tree folder selects it in the tree until the next navigation (shared `sf-tree`).
  - *(Closed 2026-10-03, see the addition below.)* The UID of a media file or folder could not be changed from the library after the folder detail drawer
    was removed.
- **Addition (user-requested 2026-10-03, not in the signed-off sample; gate decision 107):** the Rename dialog carries the UID in developer mode, for files and
  folders. `MediaRenameDialogComponent` gets `kind: 'file' | 'folder'` and an optional `uid` (project key, uuid, current UID, `changed`/`undone` callbacks).
  In developer mode it shows a *UID* section under the name field with the shared `sf-uid-rename` (`undoable`, same wording and affected-templates warning as
  the page settings); the UID acts on its own (own button and `PATCH /assets/{uuid}/uid`, own Undo toast) and leaves the name part (Apply, Enter) alone.
  Outside developer mode the dialog is as before. Files: `MediaItemActions.rename` passes the uid data (so the grid/list menu, F2 and the drawer's ⋮ all
  have it); a new UID reaches `MediaLibraryStore.onUidChanged(uuid, uid)` (items, allMedia/`mediaUids`, `selectedMedia`; the drawer's `media` overlays the
  row's UID), also when Undo runs after the dialog is closed (`sf-uid-rename [onUndone]`). Folders: `MediaFolderActions.rename(folder)` opens the dialog
  (`kind: 'folder'`: name required and free among the siblings; Apply goes through `renameFolderTo` with Undo) and re-reads the folders after a UID change
  or its Undo. Entry points: the tree's context menu *Rename…* and the page header's ⋮ *Rename folder…*; F2 in the tree stays the quick inline name edit
  (the header entry no longer shows F2). The URL names folders and files by uuid, so a UID change never changes it. The drawer's Details UID stays read-only.
- **Checks:** full `npx vitest run` 314 files / 3,161 tests, zero unhandled errors; `npx ng build` green (no budget change needed; initial total 2.52 MB);
  `npm run lint` green (baselines updated: i18n 72 files); Gradle compile of all modules, spotless, and `MediaDownloadIntegrationTest` (3),
  `RevisionAwareReferencesIntegrationTest` (5), `LocalizedMediaIntegrationTest` (13), `MediaTextApiTest` (8), `ProjectDetailMediaLimitsApiTest` (2),
  `ArchivedProjectEndpointWalkTest` (1), `PublishPolicyApiTest` (8), `CodeHighlightingIntegrationTest` (7) green. Browser review in headless Chromium against a
  scratch backend: 169 states at 1440 and 1024 (light and dark, comfortable and compact) and 390 (five states), each with exactly one `h1`, a correct heading
  order and no sideways page scroll; keyboard walkthrough (tab order, focus rings, `Shift+F10`, `?` sheet, palette).
  Journeys: the new `e2e/m35-media-journeys.spec.ts` (upload, keyboard, edit/save, leave dialog, F2 rename, replace, delete + Undo, list view) passes; m16 journey 2,
  m18 journey 2 and m23 "media by alt text" pass; m6, m16, m18, m22, m23, m27 and m29 were updated to the new drawer (Used by tab, ⋮ menu, `sf-file-drop`, Processing
  tab, leave dialog, history drawer instead of the revision spine, the sign-in form).
- **Open:**
  - Journeys that cannot run for reasons outside the media UI: m16 j1 (j3 and j4 read generated files too and were not run), m18 j1 (generation tail) and j3, and m22 (steps before the media drawer)
    fail because builds only publish released content (M27) and the journeys never release; m27 starts from the old pages tree (`sf-page-nav-node`); m29 from the old
    account menu; m3 and m6 need the `demo` seed. M35.31 reworks them (their media steps are updated and read correctly against the new DOM).
  - At the drawer's default width (420 px below 1280, else 520) a text file's tab bar puts Processing / Rendered / Used by in "More"; a wider default or a
    different tab order for text media is a design question.
  - At 390 px the 232 px rail stays and the library pane is off screen (M35.27); the drawer itself works.
  - The shared `sf-tree` counts shift 30 px left on the focused or hovered row (its ⋮ placeholder).
