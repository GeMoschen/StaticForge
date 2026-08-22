# Feature: Preview

**Spec:** §19 (entire).
**Area:** backend + frontend. **Epic:** M3.

## Goal

Implement the preview subsystem: same render engine, sandboxed route, link rewriting,
split view + viewport switcher + section highlighting.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-preview-backend.md](001-preview-backend.md) | M2.4.2, M3.5.2 |
| 2 | [002-preview-frame-ui.md](002-preview-frame-ui.md) | M3.4.2 |
| 3 | [003-preview-share-links.md](003-preview-share-links.md) | 1 |

## Feature exit criteria

- [ ] Live/saved/revision/section/channel previews work via the same render path.
- [ ] Split view + viewport switcher + section highlight (`data-sf-instance`) work.

## Dependencies

`M2:renderer`, `M3:pages`, `M3:media`.
