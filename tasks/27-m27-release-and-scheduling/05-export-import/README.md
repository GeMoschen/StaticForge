# Feature: Export/import — release state in archives (protocol 8)

**Spec:** Extends §26.5 (export/import, protocol history).

## Goal

Archives carry each asset's release state and localized media files; an import either keeps the archive's release
state or brings everything in as drafts.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-release-state-in-archives.md](001-release-state-in-archives.md) | `M27.1.1`, `M27.3.1` |
| 2 | [002-import-release-option-ui.md](002-import-release-option-ui.md) | 1 |

## Feature exit criteria

- [x] Protocol 8 round-trips release pointers (per locale, incl. released payloads that differ from the draft) and
      localized media files.
- [x] Import option "keep release state" (default) / "everything as draft" in API and UI; protocol ≤ 7 imports as drafts.
- [x] `./gradlew build`, `npm run build`, `npx vitest run` green.

## Dependencies

`M10` / `M14` (selective export/import, per-asset export files), `M25` (protocol 7), `M27.1.1`, `M27.3.1`.
