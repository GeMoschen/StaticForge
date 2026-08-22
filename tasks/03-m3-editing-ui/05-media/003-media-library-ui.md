---
id: M3.5.3
status: done
depends: [M3.3.3, M3.5.1]
epic: m3-editing-ui
feature: media
area: frontend
---

# M3.5.3 — Media library UI

## Context

Implement the media library screen (§24.5 #5).

## Goals

- Grid with focal-point-aware thumbnails (virtual scroll).
- Drop-anywhere upload (single + bulk), progress indicators.
- Detail drawer: metadata, variants, usages (from `/usages`), replace-binary action.
- Alt-text requirement surfaced (a validation, not a nag, §24.7).

## Acceptance criteria

- [ ] Uploading a file lands in the grid and generates thumbnails.
- [ ] Usage list shows referencing pages; delete warns and requires confirmation.

## Out of scope

- Batch metadata editing polish.

## Notes / hazards

- Reuse `sfDropTarget` directive (M0.4.3).
