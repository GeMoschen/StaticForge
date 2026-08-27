---
id: M13.1.3
status: todo
depends: [M13.1.2]
epic: m13-template-store-folders
feature: template-store-domain
area: backend
---

# M13.1.3 — Template create/move wired to folders

## Context

`FolderScope.requiredFor(AssetType)` currently returns `null` for
`PAGE_TEMPLATE`/`SECTION_TEMPLATE`, which is exactly why
`AssetServiceImpl.validateFolderScope` is a no-op for them today and
`TemplateServiceImpl.create` hardcodes `parentFolderUuid = null` in the
`CreateAssetCommand` it builds. This task flips both: templates become
folder-scoped assets, placeable under their matching fixed folder or any
subfolder beneath it. Moving an existing template between folders is
expected to come for free from `AssetController`'s existing generic
`/assets/{uuid}/move` (already asset-type-agnostic, dispatching to
`AssetService.move` for non-folder assets) — confirm that, don't rebuild it.

## Goals

- `FolderScope.requiredFor` returns `TEMPLATES` for both `PAGE_TEMPLATE` and
  `SECTION_TEMPLATE`.
- `CreateTemplateCommand` gains a `parentFolderUuid` (nullable). `null`
  resolves to the matching fixed folder itself (via `M13.1.2`'s
  `ensureTemplateFolders`) — never a validation error, so template creation
  keeps working with zero UI changes until `M13.3` lands.
- `TemplateServiceImpl.create` passes this through to
  `AssetService.create`'s `CreateAssetCommand.parentFolderUuid` instead of
  the hardcoded `null`.
- New validation (defense in depth on top of `M13.1.2`'s `templateKind`
  inheritance): the resolved parent folder's `templateKind` must match
  `cmd.kind()` — a `PAGE_TEMPLATE` create resolving to a folder under
  "Section Templates" (or vice versa) is rejected with the same style of
  422 `AssetServiceImpl.validateFolderScope` already uses for
  cross-`scope` placement.
- `CreateTemplateRequest`/`AbstractTemplateController` (API DTO layer)
  gains the `parentFolderUuid` field end-to-end (request → command →
  response `TemplateDetail`/`TemplateSummary`, matching however folder
  membership is already surfaced on `FolderView`/other asset detail DTOs —
  confirm the existing pattern, e.g. `PageSummary`/`PageDetail`'s
  equivalent field, before inventing a new shape).
- Confirm (with an integration test, not by inspection alone) that
  `POST /assets/{uuid}/move` already moves a template between two folders
  under the same fixed root correctly, and rejects a move across roots
  (`PAGE_TEMPLATE` into a "Section Templates" subfolder) via the existing
  cross-scope guard now that `requiredFor` is non-null for templates.

## Acceptance criteria

- [ ] Creating a template with no `parentFolderUuid` lands it under the
      correct fixed folder (by kind) — existing callers/tests unaffected.
- [ ] Creating a template with an explicit `parentFolderUuid` under the
      correct kind's subtree succeeds; under the wrong kind's subtree, or
      under any Pages/Media/Navigation folder, is rejected.
- [ ] `POST /assets/{templateUuid}/move` relocates a template between two
      folders of the correct kind and is rejected across kinds — proven by
      an integration test, no new move code needed if the existing
      generic path already handles it.
- [ ] `GET`/list template endpoints return the template's current folder
      (uuid/path) so the frontend (`M13.3`) can render it in the right tree
      position.

## Out of scope

- The two fixed folders' provisioning itself — `M13.1.2`.
- UI changes — `M13.3`.

## Notes / hazards

- Do not let this task quietly change uid derivation/uniqueness —
  `UidGenerator.deriveUid`/`findByProjectIdAndAssetTypeAndUid` stay scoped
  to `(project, AssetType)` only; a folder-scoped uid check would be a
  regression the user explicitly ruled out. Add a test that two page
  templates in *different* folders still collide on the same uid.
