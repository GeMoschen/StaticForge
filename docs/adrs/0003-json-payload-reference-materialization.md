# ADR-0003 — Single JSON payload column with indexed projections and materialized references

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** Tech lead (specced in `cms-specification.md` §5.3, §5.4)

## Context

Content shapes are user-defined: CDL declares arbitrary editors, so a fixed relational projection would demand dynamic DDL every time a template changes. Classic CMS schema divergence (six table trees per asset type) was rejected as unmaintainable.

## Decision

1. **JSON payload column per type.** All type-specific state lives in `asset_version.payload` (`JsonNode`, mapped via Hibernate `@JdbcTypeCode(SqlTypes.JSON)`). The column is `jsonb` on PostgreSQL and `CLOB` on H2 via `dbms`-scoped Liquibase changesets. The relational schema stays stable while content evolves.

2. **Indexed projections for query/integrity fields.** The handful of fields needed for hot-path queries and integrity — `uid`, `display_name`, `folder_id`, `folder_path`, `template_asset_id`, `mime_type`, `size_bytes` — are stored as real columns on `asset_version` and kept in sync by the domain layer. JSON is never used as a query predicate in a hot path.

3. **`asset_reference` materialization.** Outgoing edges of each asset version are materialized as `AssetReference` rows typed by `ReferenceKind` (`TEMPLATE`, `CONTENT_REF`, `MEDIA_REF`, `OCTL_VALUE`, `OCTL_REF`, `OCTL_INCLUDE`, `NAV`). References are stored **by asset id / UUID**, never by UID, so renames never break content. The reverse edges (indexed on `to_asset_id`) power three features: the usage view ("where is this image used?"), incremental generation, and broken-link reporting after a delete.

## Consequences

- Renaming a UID never breaks content: UIDs are resolved to UUIDs at authoring/compile time and the compiled template stores the UUID (spec §5.4, §16.4).
- Partial indexes (`WHERE valid_to_revision IS NULL`) keep "current state" queries fast regardless of history depth (spec §22.2).
- The `ContentReferenceService` / `ContentValidator` in `sf-domain` are responsible for deriving references from content values so the materialized table stays consistent with the payload.
- Portability between PostgreSQL (`jsonb`) and H2 (`clob`) is the main ongoing cost, contained by the `dbms`-scoped changesets and a nightly Testcontainers run against real PostgreSQL (§22.3).
