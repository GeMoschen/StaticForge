---
id: M1.3.1
status: done
depends: [M0.3.2]
epic: m1-identity-revisions
feature: asset-identity
area: backend
---

# M1.3.1 — Asset & AssetVersion entities

## Context

Realize the §5.2 identity/state split and the §5.3 payload strategy in code.

## Goals

- Implement `asset` (uuid, project_id, type, uid, created_at/by) and `asset_version`
  (valid_from/to revision, deleted, display_name, folder_id, folder_path,
  template_asset_id, mime_type, size_bytes, **payload JSON**, changed_by/at) per §22.2.
- Apply the JSON payload mapping (§5.3) and the indexed projections (uid, display name,
  folder path, template ref, mime, size) as real columns.
- Add the `asset_type` discriminator enum and Liquibase changesets for both tables and
  the indices (§22.2).

## Acceptance criteria

- [ ] `asset_version` payload round-trips as `JsonNode` via `@JdbcTypeCode(SqlTypes.JSON)`.
- [ ] The `uq_asset_project_type_uid` constraint and partial indices exist and validate.
- [ ] No update path mutates `asset` identity columns except the UID-rename op (later).

## Out of scope

- Revision interval *writing* (feature 4) — these are schema + read shape only.
- asset_reference table (M2).

## Notes / hazards

- Keep JSON out of query predicates (§5.3); projections are the real columns.
