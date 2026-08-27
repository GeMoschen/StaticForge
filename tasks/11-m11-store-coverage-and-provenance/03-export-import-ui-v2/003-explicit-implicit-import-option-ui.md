---
id: M11.3.3
status: todo
depends: [M11.2.2]
epic: m11-store-coverage-and-provenance
feature: export-import-ui-v2
area: frontend
---

# M11.3.3 — Explicit/implicit-aware import option and conflict display

## Context

`M11.2.2` adds `explicit` provenance to conflict-relevant assets and a
`skipExistingImplicit` option to `analyzeImport`/`commitImport`. The import
panel (`project-settings-import.component`, `M10.3.3`) needs to expose the
option and make the conflict report legible in these terms, consistent with
`M10.2.2`'s "analyze and commit share one detection path" principle — the
displayed report must always reflect what a commit would actually do.

## Goals

- A checkbox in the import panel (default **off**, matching the backend's
  default-preserves-`M10`-behavior choice) — copy is a polish decision, not
  an architectural one (e.g. "Skip ancestor folders that already exist").
- Toggling it re-runs `analyzeImport` with the option set (not just
  `commitImport` — the point is the *displayed* Blocking/Warnings split must
  update live, per `M10.2.2`'s shared-detection-path principle), so the user
  sees the real effect before committing.
- Each conflict row shows whether it concerns an explicit or implicit
  element (a small tag/badge, reusing `M10.3.3`'s existing icon/badge
  convention — no new shared component needed for this).

## Acceptance criteria

- [ ] Toggling the option re-analyzes and updates the Blocking/Warnings split
      without a full page reload.
- [ ] A `DUPLICATE_UUID` conflict on an implicit element disappears from (or
      is demoted out of) the Blocking section once the option is enabled.
- [ ] The same conflict on an explicit element is unaffected by the toggle in
      every case.
- [ ] Import remains disabled while any conflict still classified as
      `BLOCKING` under the current toggle state is present.

## Out of scope

- Per-conflict manual override controls — unchanged from `M10`'s
  report-then-accept-or-cancel scope; this is a single global switch, not a
  per-item resolution UI.
- `project-settings-export.component` — untouched by this task.

## Notes / hazards

- Re-analyzing on toggle means an extra network round-trip each time the
  user flips the checkbox — acceptable (mirrors how filters already
  re-trigger loads elsewhere in this codebase, e.g.
  `project-settings-url-registry.component`), but debounce if toggling
  rapidly would otherwise fire redundant requests.
