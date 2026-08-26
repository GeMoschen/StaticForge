# Feature: URL registry

**Spec:** New capability, not previously in `cms-specification.md`; extends §15
(channels) and §18 (generation pipeline) with a persistent per-channel URL cache for
`PageReference`s.

## Goal

Give every `PageReference` a URL per channel that is assigned exactly once and then
cached — never silently recomputed — so links stay stable across content edits. Split
the cache into `PREVIEW` and `GENERATED` areas (matching the existing preview-vs-build
dual render path), and expose it in project settings for inspection, manual override,
and explicit reset.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-url-registry-domain.md](001-url-registry-domain.md) | M8.1.2 |
| 2 | [002-url-registry-service.md](002-url-registry-service.md) | 1 |
| 3 | [003-url-registry-integration.md](003-url-registry-integration.md) | 2, M8.1.4 |
| 4 | [004-url-registry-api.md](004-url-registry-api.md) | 2 |
| 5 | [005-url-registry-settings-ui.md](005-url-registry-settings-ui.md) | 4 |

## Feature exit criteria

- [x] A `PageReference`'s URL for a given channel, once assigned in an area, is stable
      across repeated generations/previews until an explicit reset touches that entry.
- [x] `PREVIEW` and `GENERATED` entries for the same `(PageReference, channel)` are
      independent and never overwrite each other.
- [x] Project settings exposes a working "Navigation URLs" panel.

## Dependencies

`M8.1` (navigation store — the registry has nothing to key on without `PageReference`),
`M4` (generation — `OutputPathResolver` is the fallback computation when no registry
entry exists yet), `M6` (preview render path — the `PREVIEW` area needs a hook there).
