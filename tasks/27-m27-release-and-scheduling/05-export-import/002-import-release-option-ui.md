---
id: M27.5.2
status: done
depends: [M27.5.1]
epic: m27-release-and-scheduling
feature: export-import
area: frontend
---

# M27.5.2 — Import dialog: release-state option

## Context

`ui/src/app/features/settings/project-settings-import.component.*`, `import-export.service.ts`, the analyze result
view, regenerated `schema.d.ts` (`M27.5.1`). Epic decision 28.

## Goals

- The import step after analysis shows **Release state**: radio "Keep release state from the archive" (default) /
  "Import everything as draft", with a one-line explanation each. For archives without release state (protocol ≤ 7) the
  control is replaced by the note "This archive has no release state — everything is imported as draft."
- `RELEASE_LOCALE_MISSING` conflicts are listed with the other warnings.
- The chosen option is sent as `releaseMode`.

## Acceptance criteria

- [x] Vitest: default `KEEP` sent; switching sends `DRAFT`; protocol-7 analysis shows the note and no control (fixtures
      built from the real analyze response shape — lessons).
- [x] Manual check in the running app with a protocol-8 and a protocol-7 archive.
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Export UI (unchanged).

## Notes / hazards

- None beyond the lessons on fixtures.

## Implementation notes

- **Where.** A "Release state" fieldset below the skip toggle, shown once the first analysis of the archive answers:
  two radios with a one-line hint each (`KEEP` / `DRAFT`), or — for `releaseState: false` — the note "This archive has
  no release state — everything is imported as draft." Kept in its own signal (`archiveHasReleaseState`), so the choice
  doesn't flicker away while a changed option is re-analyzed; only an explicit `false` counts as "no release state".
- **Re-analysis.** Switching the mode re-analyzes (only a kept release state can report `RELEASE_LOCALE_MISSING`),
  like the skip toggle. The mode resets to `KEEP` for a new archive and on cancel. Commit sends the chosen mode, or
  `DRAFT` for an archive without release state (what the server applies anyway).
- `RELEASE_LOCALE_MISSING` is listed with the warnings (icon `translate`); the `INFO` entry is not listed (the note
  says it). The success toast and summary mention the releases kept (`releasedCount`).
- **Tests:** `project-settings-import.component.spec.ts` (+3: default `KEEP` with the missing-locale warning and the
  kept count, switch to `DRAFT` re-analyzes and commits `DRAFT`, protocol-7 note without radios commits `DRAFT`;
  fixtures in the real `ConflictReportView` shape), `import-export.service.spec.ts` (+1: `releaseMode` form field).
