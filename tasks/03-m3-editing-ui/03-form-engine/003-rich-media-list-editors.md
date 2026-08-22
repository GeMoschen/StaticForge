---
id: M3.3.3
status: done
depends: [M3.3.1]
epic: m3-editing-ui
feature: form-engine
area: frontend
---

# M3.3.3 — Rich text, media, reference, list, group, JSON editors

## Context

Implement the complex editor controls of §14.3 that need heavier libraries or recursion.

## Goals

- `SfRichTextEditor`: TipTap with a schema derived from the editor's `features` list,
  gated toolbar (§14.3, §23.1).
- `SfMarkdownEditor`: Monaco markdown mode + split preview.
- `SfMediaEditor`: media picker + drop zone returning `{type:MEDIA_REF, uuid, variant?,
  altOverride?}`.
- `SfReferenceEditor`: asset picker with `assetTypes` filter + `folder` scope.
- `SfListEditor`: repeatable rows with CDK drag-drop + keyboard alternative.
- `SfGroupEditor`: recursive visual grouping, collapsible.
- `SfJsonEditor`: Monaco JSON mode, schema-validated.

## Acceptance criteria

- [ ] Rich text respects the `features` allow-list (no unsupported toolbar buttons).
- [ ] List reordering has a keyboard path (drag is never the only way, §23.6).
- [ ] Media/reference pickers filter by `mimeTypes`/`assetTypes` respectively.

## Out of scope

- Media *library* integration is consumed (feature 5) but picker can start with the API.

## Notes / hazards

- Lazy-load Monaco/TipTap only on these routes (§23.8).
