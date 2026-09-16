---
id: M24.2.2
status: todo
depends: [M24.2.1]
epic: m24-multi-language
feature: cdl-storage
area: backend
---

# M24.2.2 — Localizable toggle migration + localizable media metadata and navigation labels

## Context

`TemplateServiceImpl` already migrates page `bodies` payloads when an editor is renamed
(`renamedFrom`, spec §12.3) inside one compound revision (M15.2.2 moved it onto
`beginBatch`/`allocateOrJoin`). Media metadata (`altText`, `caption`, `copyright`) are
plain strings set via `MediaServiceImpl.updateMetadata` / `PUT /media/{uuid}`. Navigation
labels come from `NavigationServiceImpl.label(projectId, asset, lookup)` (~line 187):
`PageReference payload.label` → target page `displayName` → own `displayName`.

## Goals

- **Template-driven migration.** When a template save changes an editor's `localizable`
  flag, `TemplateServiceImpl` migrates every page/section instance (and M17 global set /
  M19 record whose schema changed — via the same hook those services use for renames) in
  **one** compound revision:
  - off → on: bare value `v` becomes `{type:"L10N", values:{<defaultLocale>: v}}`;
  - on → off: wrapper becomes its default-locale value (fallback chain if the default is
    missing); discarded non-default values are listed in the save response
    (`LocalizationMigrationResult`: affected assets, discarded locale count) so the UI can
    confirm before the second, confirmed save (`?confirmDiscard=true`), mirroring
    `UidChangeResult`'s "affected" reporting.
- **Project-driven migration.** When `ProjectService.updateLocales` flips
  `isLocalized()` false → true, wrap every existing value of every `localizable` editor
  across the project in the same compound revision as the settings update; true → false
  unwraps to the default locale with the same discard confirmation. Changing the default
  locale does **not** rewrite values (it changes resolution only).
- **Media metadata.** `altText` and `caption` accept either a string or an L10N wrapper
  when the project is localized; `updateMetadata` takes a `locale` parameter and writes into
  the wrapper; `copyright` stays single-valued. `$CMS_VALUE(heroImage.altText)$`
  resolution is handled in M24.3.1.
- **Navigation labels.** `PageReference payload.label` accepts an L10N wrapper;
  `NavigationServiceImpl.label(...)` gains a locale/chain parameter; the navigation REST
  API (`NavigationController`) accepts `locale` on label updates. `NavTreeNode.label`
  becomes the resolved label for the requested locale.
- Batch size: migrations over large projects stream versions in pages; one revision, many
  `appendSummary` entries — reuse the M15 batch mechanism, no bespoke loop.

## Acceptance criteria

- [ ] Integration test: template with 3 pages using `headline`; toggling `localizable` on
      wraps all 3 in one revision whose `summary.assets` lists the template + 3 pages.
- [ ] Toggling off with an `en` translation present returns the discard report without
      writing; confirmed save unwraps and writes one revision.
- [ ] Enabling project locales wraps values of already-localizable editors in the same
      revision as the locale settings change; disabling unwraps after confirmation.
- [ ] Section instances inside bodies and list-item leaves are migrated (not only
      top-level `content`).
- [ ] Media `altText` per locale saved and read back; nav label per locale resolved by
      `NavigationService.tree` for `de` and `en`.
- [ ] `RevisionInvariantsTest` still green (compound revision invariants).

## Out of scope

- UI for these flows (M24.4.1).
- Rendering media/nav labels per locale in generation (M24.3.1/M24.3.2).

## Notes / hazards

- **Data loss risk** is the core hazard: never unwrap without the explicit confirm flag;
  never drop values for locales merely because they were removed from the project.
- The migration must be idempotent (re-running on already-wrapped values is a no-op) so a
  retried request after a timeout can't double-wrap.
- Media `share`/preview drawers read `altText` as a string today
  (`media-detail-drawer.component.ts`) — the API view should expose both `altText`
  (resolved for the requested/default locale) and `altTextL10n` to avoid breaking existing
  clients.
