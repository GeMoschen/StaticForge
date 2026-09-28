# M31 — Folder start pages (a folder names the page that renders as its index file)

**Spec:** Extends §10.2 (folders; the pages root), §15.2 (channel `indexUid`), §16.4 (folder references), §17
(navigation folder resolution), §18.2 (planner edge), §18.3 (output paths), §18.9 (redirect causes), §20.2 (REST
catalogue), §24 (Pages and Navigation screens), §26.5 (export protocol 11), Appendix B. Not part of the original §27
roadmap — inserted the same way `M8`–`M30` were.

## Goal

A user can't make a page called "Homepage" render as the site's `index.html`. Today a page becomes its folder's index
file only when its **UID** equals the channel setting `indexUid` (default `index`, `OutputPathExpander.expand`), and
UIDs are unique per project and type, so only one page per project can ever be an index. There is no per-folder choice,
and the site root isn't even selectable in the Pages or Navigation screens (the Navigation root's existing "Entry page"
picker is unreachable — `navigation.component.ts:103`, a bug).

After M31 every PAGES folder, **including the site root (`pages_root`)**, can name one of its own pages as its **start
page**; that page always renders as the folder's index file, and every consumer that asks "which page is this folder's
index?" (folder references, preview links, navigation, URL registry, planner, redirects UI) gets the same answer.

## User decisions (2026-09-28)

1. The start page **always renders at the folder's index path** (`{locale}/{folder}{indexStem}.{ext}`, directory form
   with pretty URLs, `index-2.html` for pagination), ignoring the template's `outputPath`; only an explicit per-page
   `pathOverride` still wins.
2. The channel's `indexUid` rule **stays as the fallback** for folders without a start page; inside a folder with a
   start page, the start page wins.

## Findings from planning

1. Pages live under the protected folder `pages_root` (path `/pages_root/`, `FolderScope.PAGES_ROOT_UID`); it is the
   site root for output paths (`OutputPathExpander.relativeFolder` strips `pages_root/`). The hidden `root` (`/`,
   no scope in its payload) sits above every store. `pages_root` is not releasable (`ReleasableTypes`), so its payload
   is live.
2. The only index decision is `OutputPathExpander.expand` (`{uid}` → `indexStem` when `uid == indexUid`). Consumers
   that bypass it: `GenerationRenderer.resolveFolder` (also doesn't strip `pages_root/`), `PageRenderService.urlResolver`
   (issues a *page* share token for a folder uuid), `NavigationServiceImpl.firstNavigablePage`, URL registry
   assign-once rows, `RebuildExpansion` FOLDER case, UI `redirect-option.util.ts nearestIndexPage`.
3. Closest existing pattern: `StartNode` + `FolderServiceImpl.updateStartNode` + `NavigationController.updateFolder`
   (navigation folders' own pointer — a different concept, kept as is).
4. Export protocol is 10 (`QUALITY_AND_REDIRECTS_PROTOCOL`); fixed roots are skipped on import. No Liquibase change:
   the setting lives in the folder payload JSON.

## Decisions (binding for all tasks — revisit only with the user)

1. **Model.** A PAGES folder's payload gains `startPage: "<page uuid>"` (absent or `null` = none). Read through
   `StartPage.fromPayload(JsonNode) → UUID|null` (`asset/folder/StartPage.java`, modelled on `StartNode`; malformed
   values read as none). Allowed on `pages_root`; refused on the hidden `root` and on every non-PAGES folder. It is
   released with the folder like the rest of its payload (per locale); `pages_root`'s is live.
2. **Setting it.** `FolderService.updateStartPage(folderUuid, pageUuid|null, expectedRevision, ctx)`: the folder must be
   a live PAGES folder (`422` otherwise); the page must be a live `PAGE` whose current `folderId` is this folder
   (`422`); protected folders are **not** refused (that is what makes `pages_root` work). Writes through
   `assetService.update` (one `UPDATE` revision, payload deep-copied — lesson "never edit a loaded payload"), so history,
   time travel and `If-Match` behave like every asset edit; an unchanged value writes nothing (the revision is still
   checked). Asset edits are not audited separately; the revision is the audit trail.
3. **Index claim conflict.** Setting a start page is refused with **`409 SF-DOM-0111`** when another live page in the
   folder would also be written at the folder's index path — its UID equals the index stem of any of the project's
   channels (`ChannelOutputSettings.indexStem()`, defaults when the project has none). The problem names the page
   (`conflictingPageUuid`, `conflictingPageUid`) and suggests renaming its UID. A page whose UID equals `indexUid` but
   not the stem is no conflict: with a start page it simply renders under its own UID (decision 2 of the user). The
   build's `SF-GEN-0110` collision stays the backstop for conflicts that arise later (a page created, renamed or moved
   into the folder, a `pathOverride`, a template expression).
4. **REST.** `PATCH /api/v1/projects/{key}/folders/{uuid}` with body `{"startPage": "<uuid>"|null}` and
   `If-Match: "rev-N"` (`412 SF-API-0412` missing, `409 SF-API-0409` stale), role `EDITOR` (same as folder rename);
   answers the `FolderView` with `ETag`. A body without `startPage` changes nothing and answers the current view.
   Archived projects are refused by the M26 guard (`409 SF-DOM-0141`). `FolderView.startPageUuid` (nullable) carries the
   folder's draft pointer in the tree (`GET /folders?scope=PAGES`) and in every folder response.
5. **Reference edge.** `ReferenceMaterializer` emits `ReferenceKind.START_PAGE` folder → page (source path
   `startPage`) for FOLDER assets. Consequences: usages list the folder; releasing a folder proposes its unreleased
   start page (release closure follows outgoing edges); the delete guard (`isReferencedByLiveAssets`) **ignores**
   `START_PAGE` edges — deleting, unpublishing or moving the start page is allowed and the folder falls back.
6. **Effective start page.** For a page P in a view (the released snapshot per locale, or the live drafts): P is the
   start page iff `folder(P)` is present in the view and `StartPage.fromPayload(folder.payload) == P.uuid`. A folder
   *has* a start page in a view iff its pointer names a page present in that view whose folder is this folder. A stale
   pointer (page moved away, deleted, not released in that locale) simply doesn't match → the folder falls back to the
   `indexUid` rule.
7. **Output path.** `OutputPathExpander.PageContext` gains `boolean startPage` and `boolean folderHasStartPage`.
   Expression order: `pathOverride[channel]` → the start page's folder index expression (the default expression
   `{folder}{uid}.{ext}` / `{locale}/{folder}{uid}.{ext}` with `{uid}` → `indexStem`) → template `outputPath` →
   default. `{uid}` → `indexStem` applies to the start page, and to the `indexUid` page **only when its folder has no
   start page**. Directory form, `indexFileName` and pagination (`index-2.html`, `paginationPath`) keep working because
   they build on the resolved path. Both resolvers (`OutputPathResolver`, `LiveOutputPathResolver`) fill the flags.
8. **Stale-pointer diagnostic.** A build warns **`SF-GEN-0112`** "Start page of folder '<uid>' is not available in
   <locale>; the folder falls back to the index UID rule" once per (folder, locale) for each folder that holds a page
   of the plan in that locale and whose pointer is set but not effective (decision 6). Like every render warning it
   makes the run `PARTIAL`.
9. **Consumers follow** (all resolve "the folder's index page" = start page, else the `indexUid` page): `$CMS_REF(folder:…)`
   links the index page's URL (else today's directory link, now without the `pages_root/` segment); preview folder
   links use the index page's share link; navigation folder entries and folder-kind page references prefer the index
   page before "first navigable page"; a start-page change deletes the non-overridden GENERATED/PREVIEW URL-registry
   rows of page references that resolve to the old or new start page or to that folder; the UI's `nearestIndexPage`
   uses start pages first.
10. **Incremental planning.** A changed PAGES folder reaches its current and baseline start pages and its `indexUid`
    page via a new `RebuildEdgeKind.START_PAGE`; their `outputMoved` walks to linkers and navigation as today. Redirects
    need no code: moved outputs get AUTO entries; the old start page's `index.html` entry comes out `SHADOWED`.
11. **Export/import protocol 11.** Folder payloads carry `startPage` (UUIDs survive import). Fixed roots are skipped on
    import, so the archive's `pages_root` start page is merged into the target's `pages_root` when it has none (a
    non-blocking conflict entry when it differs); protocol ≤ 10 archives import unchanged.
12. **UI.** Folder detail "Start page" select (the folder's own pages, hint "Renders as this folder's index.html"),
    `pages_root` reachable from "All pages" with protected handling, "Start page" badge and "Make start page of
    <folder>" in the page tree, Navigation root selectable (bug fix; "Entry page" = navigation, "Start page" = index
    file), Channels "Index page UID" hint "…unless the folder has a start page".
13. **Codes.** `SF-DOM-0111` (409, index claim conflict), `SF-GEN-0112` (warning, stale start page). Other invalid
    targets are the generic `422 SF-API-0422`.

## Exit criteria (epic is done when)

- [x] A page "Homepage" (template with its own `outputPath`) set as start page of `pages_root` renders as `index.html`
      (pretty: `./`; localized: `de/index.html`; paginated: `index-2.html`); a `pathOverride` still wins.
- [x] A stale pointer falls back to the `indexUid` rule with `SF-GEN-0112`; a conflicting `index` page is refused at
      set time (`SF-DOM-0111`) and collides at build time (`SF-GEN-0110`) when it arises later.
- [x] Folder references, preview links, navigation and URL-registry hrefs resolve to the start page.
- [x] Changing a start page re-renders the old and new start page, the linkers and navigation incrementally; AUTO
      redirects and shadowing work; export/import protocol 11 round-trips the setting, `pages_root` included.
- [x] The UI sets and shows start pages for every PAGES folder including the root; the Navigation root is selectable.
- [x] `./gradlew spotlessCheck build` (`test --rerun`), `ui` `npx ng build` and `npx vitest run` green; spec and guides
      updated.

## Tasks (dependency order)

| # | Task | Area | Depends |
|---|---|---|---|
| 1 | [M31.1 Model and API](001-model-and-api.md) | backend | — |
| 2 | [M31.2 Output paths](002-output-paths.md) | backend | M31.1 |
| 3 | [M31.3 Consumers](003-consumers.md) | backend | M31.2 |
| 4 | [M31.4 Planner, redirects, export/import](004-planner-redirects-import.md) | backend | M31.2 |
| 5 | [M31.5 UI](005-ui.md) | frontend | M31.1 (API) |
| 6 | [M31.6 Spec and docs](006-docs.md) | qa | M31.1–M31.5 |

The epic is small, so its tasks sit directly under the epic (one task per feature). M31.3 and M31.4 are parallel lanes
(`GenerationRenderer`/`PageRenderService`/`NavigationServiceImpl`/URL registry vs `RebuildExpansion`/export-import);
M31.5 can start once M31.1's API is merged.

## Dependencies

`M8` (navigation, URL registry), `M16` (reference materialization), `M22` (planner edges and rebuild reasons), `M24`
(locales), `M26` (archived guard), `M27` (release per locale, release closure), `M30` (redirect registry, shadowing),
`M9`/`M14` (export/import, UUIDs survive import).

## Notes

- **API shape.** Regenerate OpenAPI (`./gradlew :server:sf-app:generateOpenApi -Pfrontend.skip=true`) and
  `ui/src/app/core/api/generated/schema.d.ts` (`npm run generate:api`) after each task that changes the API.
- **Not in scope:** start pages for non-PAGES folders (navigation keeps its own `startNode`), validating index
  conflicts on page create/rename/move (the build collision is the backstop), a per-channel start page, changing the
  `indexUid` rule itself.
