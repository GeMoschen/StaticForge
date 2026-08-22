# Feature: Revision spine & time travel

**Spec:** §24.2 (revision spine), §24.1.
**Area:** frontend. **Epic:** M6.

## Goal

Build the signature 44px revision rail and the time-travel mode it powers.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-revision-spine.md](001-revision-spine.md) | M3.2.2 |
| 2 | [002-time-travel-mode.md](002-time-travel-mode.md) | 1 |

## Feature exit criteria

- [ ] The rail shows the last ~40 revisions; own changes filled, others hollow; live pulse
      on another user's change (§24.2).
- [ ] Clicking a tick enters time-travel: amber frame, read-only inputs, "Viewing revision N".

## Dependencies

`M3:project-context` (currentRevision).
