---
id: M8.1.6
status: todo
depends: [M8.1.5]
epic: m8-navigation-rewrite
feature: navigation-store
area: frontend
---

# M8.1.6 — Navigation store UI

## Context

Replace `ui/src/app/features/structures/` with a `ui/src/app/features/navigation/`
feature, following the store-feature pattern (`<feature>.service.ts` typed against
generated OpenAPI schemas + `<feature>.component.ts` signals-based state) and reusing
the shared `sf-tree` component already used for folder trees elsewhere.

## Goals

- `navigation.service.ts`: thin `HttpClient` wrapper over `M8.1.5`'s endpoints,
  `withCredentials: true`, `If-Match` built from `etagFor(revision)` — same shape as
  `channels.service.ts`/`pages` services.
- `navigation.component.ts` + `.html`/`.scss`: tree view (folders + `PageReference`
  leaves) using `sf-tree`; selecting a node opens a detail drawer:
  - Folder detail: rename, `startNode` picker (constrained to that folder's direct
    children per `M8.1.2`'s validation), delete.
  - `PageReference` detail: target picker (searchable Page or page-folder select, kind
    toggle), optional label override, live-resolved "→ /actual/page/path" preview via
    `GET .../resolve`, delete.
- Root folder is shown and behaves like any other folder node (rename disabled, delete
  disabled — matching how the Page/Media store roots are special-cased in the existing
  tree UI, if they are; otherwise match whatever root convention those stores use).
- Route registration under the project shell (mirrors how `structures` was routed) and
  a nav-rail entry replacing the old "Structures" link with "Navigation".

## Acceptance criteria

- [ ] Tree renders the full navigation folder structure with `PageReference` leaves,
      matching `GET .../navigation/tree`.
- [ ] Creating/renaming/moving/deleting folders and references works end-to-end against
      the real API (manual verification via `npm run dev`/`ng serve` + backend, not
      just unit tests).
- [ ] `startNode` picker only offers valid direct children and reflects `null` as "no
      entry page" clearly in the UI.
- [ ] `PageReference` detail shows the live-resolved target path, updating when the
      target changes.
- [ ] Vitest component tests for tree rendering and the two detail-drawer forms.

## Out of scope

- URL registry settings panel (`M8.2.5`).

## Notes / hazards

- Confirm the shared `sf-tree` component supports heterogeneous node types (folder vs.
  reference) with distinct icons/actions before assuming it can be reused as-is.
