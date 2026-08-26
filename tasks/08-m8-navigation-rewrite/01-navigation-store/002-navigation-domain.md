---
id: M8.1.2
status: todo
depends: [M8.1.1]
epic: m8-navigation-rewrite
feature: navigation-store
area: backend
---

# M8.1.2 — Navigation store domain model

## Context

Model the navigation store the same way Pages and Media are modeled: a `FolderScope`
partition of the shared `Folder`/`PathService` machinery, plus a new asset type for the
leaf nodes. Unlike Pages, a navigation folder itself carries navigation-relevant state
(`startNode`), and the leaf asset (`PageReference`) is a pointer, not content.

## Goals

- Add `FolderScope.NAVIGATION` to the existing `FolderScope` enum; root creation on
  project create follows the same path as the Page/Media store roots (`PathService`,
  `ROOT_PATH`/`ROOT_UID` conventions) — the navigation root is a normal folder, not a
  special-cased node.
- Extend the navigation folder's payload with a single new field: `startNode` —
  nullable reference (`{ kind: PAGE_REFERENCE | FOLDER, assetUuid }`) to a child within
  the same folder. `null` means the folder itself is not directly navigable (pure
  grouping node).
- Add `AssetType.PAGE_REFERENCE`. Payload:
  - `target.kind`: `PAGE | FOLDER` (the *page-store* folder scope, i.e.
    `FolderScope.PAGES`, not a navigation folder).
  - `target.assetUuid`: the referenced `Page` or page-store `Folder`.
  - Optional `label` override (falls back to the target's `displayName` when absent —
    mirrors §17.1's `coalesce(nav.label, displayName)` behavior from the old grammar).
- Document (in this file's Notes) the resolution rule used by `M8.1.3`: a
  `PAGE`-targeted reference is direct; a `FOLDER`-targeted reference resolves to that
  folder's first navigable page, and a navigation folder's own `startNode` — when set —
  is what makes an intermediate nav folder itself clickable/linkable.

## Acceptance criteria

- [ ] A project's navigation root folder is auto-created on project create, alongside
      the existing Page/Media roots, using the shared `FolderService`/`PathService`.
- [ ] Navigation folders support create/rename/move/delete through the generic
      `FolderService`, scoped to `NAVIGATION`, with the same revisioning as other
      folders.
- [ ] `PageReference` create/update round-trips through `AssetService` with
      `RevisionContext`, validated against the CDL-less fixed payload shape above (no
      CDL involved — this is not a content-editable asset).
- [ ] Validation rejects a `PageReference` whose `target.assetUuid` does not exist or is
      not the declared `target.kind`.
- [ ] Validation rejects a folder `startNode` pointing outside that folder's direct
      children.

## Out of scope

- Resolving a folder-targeted reference to a concrete page (service-layer concern,
  `M8.1.3`).
- Rendering (`M8.1.4`), API surface (`M8.1.5`), UI (`M8.1.6`).

## Notes / hazards

- Two distinct "pointer" concepts exist and must not be conflated: (1) `PageReference →
  Folder` resolves to that folder's *first navigable page* (content-store lookup); (2)
  navigation `Folder.startNode` resolves to *a child within the nav tree itself*
  (nav-store lookup). Keep them as separate fields/types even though both are nullable
  references.
- `PathService.MAX_DEPTH` (12) applies to navigation folders too — no special-casing.
