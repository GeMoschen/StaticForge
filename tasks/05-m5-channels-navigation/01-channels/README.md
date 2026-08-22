# Feature: Output channels

**Spec:** §15 (entire), §20.2 (channels + §15.3 CRUD).
**Area:** backend + frontend. **Epic:** M5.

## Goal

Model and CRUD output channels, with the protected `html` default, enable/disable, and
delete-blocking when templates exist.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-channel-domain-api.md](001-channel-domain-api.md) | M1.1.1 |
| 2 | [002-channel-ui.md](002-channel-ui.md) | 1, M3.2.2 |

## Feature exit criteria

- [ ] `html` created with each project, non-deletable (only disable); other channels
      CRUD-managed.
- [ ] Deleting a channel with templates is blocked, listing them.

## Dependencies

`M1:project-domain`, `M3:project-context` (UI).
