# Feature: Generation UI

**Spec:** §24.5 (#10 generate).
**Area:** frontend. **Epic:** M4.

## Goal

Build the generate dialog, live log (SSE), run history, and rollback control.

## Tasks

| # | Task | Depends |
|---|---|---|
| 1 | [001-generation-ui.md](001-generation-ui.md) | M4.5.2 |

## Feature exit criteria

- [ ] Dialog (mode/channels/target/comment) → live log with per-stage progress + error
      grouping → file-count summary; errors link to the offending template line.

## Dependencies

`M4:generation-api`.
