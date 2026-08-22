# Feature: Usage & UID-rename warnings

**Spec:** §5.4 (usage view), §6.4 (UID rename warning).
**Area:** frontend + backend. **Epic:** M6.

## Goal

Expose "where is this used?" and the UID-rename template warning flow.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-usages-panel.md](001-usages-panel.md) | M2.2.3 |
| 2 | [002-uid-rename-warning.md](002-uid-rename-warning.md) | 1, M1.3.3 |

## Feature exit criteria

- [ ] Usages show inbound references before delete, powered by `asset_reference`.
- [ ] UID rename lists affected OCTL templates so the dev can fix them.

## Dependencies

`M2:content-validation`, `M1:asset-identity`.
