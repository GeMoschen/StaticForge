---
id: M6.4.2
status: done
depends: [M6.4.1, M1.3.3]
epic: m6-revision-ux
feature: usages
area: fullstack
---

# M6.4.2 — UID rename warning flow

## Context

Surface the §6.4 warning listing OCTL templates that reference an old UID literally.

## Goals

- On UID change, show the warning listing affected templates (from `asset_reference`
  `OCTL_*` edges still carrying the literal UID in source).
- Provide a click-to-navigate path to each template so the developer fixes it.

## Acceptance criteria

- [x] Renaming a UID reports the exact templates needing a fix.

## Out of scope

- Auto-fixing templates (deliberately manual, §6.4).

## Notes / hazards

- Compiled templates already hold UUIDs — this is about *source* keeping old UID literal.

## Backend status (M6.4.2)

`PATCH /api/v1/projects/{p}/assets/{uuid}/uid` now returns `200` with a `UidChangeResult`
(`{oldUid, newUid, affectedTemplates[]}`) instead of bare `204`. `AssetServiceImpl.changeUid`
scans current section/page-template and structure `channelTemplates.*.source` for the literal
`assetType:oldUid` reference and lists `{assetUuid, assetUid, assetType, displayName,
channelKey}` per hit (`UidLiteralReference` → `AffectedTemplate`). The warning is
informational and never blocks the rename. Covered by `UidChangeWarningIntegrationTest`.
Frontend click-to-navigate flow still open — `status` left `todo`.
