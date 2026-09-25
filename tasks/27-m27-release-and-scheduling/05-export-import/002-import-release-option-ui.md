---
id: M27.5.2
status: todo
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

- [ ] Vitest: default `KEEP` sent; switching sends `DRAFT`; protocol-7 analysis shows the note and no control (fixtures
      built from the real analyze response shape — lessons).
- [ ] Manual check in the running app with a protocol-8 and a protocol-7 archive.
- [ ] `npm run build` and `npx vitest run` green.

## Out of scope

- Export UI (unchanged).

## Notes / hazards

- None beyond the lessons on fixtures.
