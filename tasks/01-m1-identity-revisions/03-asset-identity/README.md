# Feature: Asset identity (UUID, UID)

**Spec:** §5 (domain model, identity vs state, reference integrity), §6 (UUID, UID
derivation, rename).
**Area:** backend. **Epic:** M1.

## Goal

Implement the asset identity layer: the `asset`/`asset_version` split, immutable UUIDv7,
the UID derivation algorithm with uniqueness/reserved-word handling, and UID rename.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-asset-version-entities.md](001-asset-version-entities.md) | M0.3.2 |
| 2 | [002-uuid-uid-generator.md](002-uuid-uid-generator.md) | 1 |
| 3 | [003-uid-rename.md](003-uid-rename.md) | 2 |

## Feature exit criteria

- [ ] `asset` row is immutable (except UID rename); `asset_version` carries all mutable
      state with revision intervals (§5.2).
- [ ] `deriveUid` reproduces every example in §6.3 table verbatim.
- [ ] Uniqueness constraint `(project_id, asset_type, uid)` + probe retry work under
      concurrency.

## Dependencies

`M0:database-liquibase`, `M1:project-domain`.
