# Feature: Conflict drawer

**Spec:** §24.6 (conflicts as a conversation), §7.5.
**Area:** frontend. **Epic:** M6.

## Goal

Build the field-level merge drawer shown on `409` conflict.

## Tasks

| # | Task | Depends |
|---|---|---|
| 1 | [001-conflict-drawer.md](001-conflict-drawer.md) | M3.4.3 |

## Feature exit criteria

- [ ] On `409`, a drawer shows both versions field-by-field with "keep mine / take
      theirs", who changed what when (§24.6).

## Dependencies

`M3:pages` (autosave already surfaces 409) — this refines the conversation.
