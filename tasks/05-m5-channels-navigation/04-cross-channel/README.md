# Feature: Cross-channel correctness

**Spec:** §2 (G3), §16.7, §25.6 (journey 4).
**Area:** qa. **Epic:** M5.

## Goal

Prove the "one content set, many channels" promise with E2E and golden files for nav/breadcrumb.

## Tasks

| # | Task | Depends |
|---|---|---|
| 1 | [001-cross-channel-e2e.md](001-cross-channel-e2e.md) | M5.2.1, M5.3.4 |

## Feature exit criteria

- [ ] Journey 4 passes; nav/breadcrumb golden files green across two channels.

## Dependencies

`M5:channels`, `M5:markdown`, `M5:structure`.
