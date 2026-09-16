# Feature: Locale-aware export/import

**Spec:** Extends §26.5 (backup/export) and the `M10`–`M14` archive format
(`manifest.json`, `assets/<uuid>.json`, `settings.json`, `blobs/<sha>`).

## Goal

Archives carry the project's locale configuration, L10N values round-trip unchanged, and
importing into a project whose locale configuration differs is reported by conflict
analysis instead of silently losing or orphaning translations.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-locale-settings-archive.md](001-locale-settings-archive.md) | M24.1.1, M24.2.1 |

## Feature exit criteria

- [ ] `settings.json` includes locale config; protocol version bumped with backward
      compatible reading of older archives.
- [ ] Locale mismatches surface as `ConflictType` entries in analyze and import.

## Dependencies

`M24.1.1`, `M24.2.1`, `M10`/`M11`/`M14` export/import.
