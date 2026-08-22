---
id: M2.2.3
status: done
depends: [M2.2.2]
epic: m2-templates-rendering
feature: content-validation
area: backend
---

# M2.2.3 — Content reference materialization

## Context

Populate the `asset_reference` table (§5.4) for content-driven edges so usage/delete
checks and (later) incremental generation work.

## Goals

- Implement `AssetReferenceService` that extracts references from content values: media
  refs (`MEDIA_REF`), asset refs (`ASSET_REF`), template refs (`TEMPLATE`,
  `CONTENT_REF`, `MEDIA_REF`), storing `(from_asset_id, revision interval, to_asset_id,
  kind, source_path)`.
- Resolve UID→UUID at authoring/parse time; store the UUID, never the UID (§5.4).
- Add the Liquibase changeset for `asset_reference` (§22.2) and its partial indices.

## Acceptance criteria

- [ ] Saving a page writes `asset_reference` rows for every referenced media/page/template.
- [ ] `GET /assets/{uuid}/usages` (§20.2) returns inbound references.

## Out of scope

- OCTL reference edges (feature 3 handles `OCTL_*` kinds).
- Incremental planning (M4 consumes the edges).

## Notes / hazards

- Keep `kind` enum aligned with §5.4 values.
