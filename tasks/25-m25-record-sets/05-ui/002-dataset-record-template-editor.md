---
id: M25.5.2
status: todo
depends: [M25.3.1]
epic: m25-record-sets
feature: ui
area: frontend
---

# M25.5.2 — Record template editor on the dataset schema screen

## Context

`features/content/dataset-schema-editor.component` edits a dataset's CDL (`M19.4.1`) with diagnostics.
The Templates store edits section/page templates with one OCTL tab per enabled channel
(`features/templates/templates.component`, diagnostics with click-to-jump, `M20` inheritance UI).

## Goals

- Add one tab per enabled channel next to the CDL tab: "Record template (html)", "(md)", … reusing the
  template store's OCTL editor component and diagnostics list (extract a shared component if it is
  currently embedded in `templates.component` — don't copy it).
- Insert helpers list the dataset's fields and the meta names (`_uid`, `_displayName`, `_index`, `_first`,
  `_last`, `_count`) for click-to-insert.
- Save sends CDL + `channelTemplates` together (one revision); show per-channel compile diagnostics and the
  `brokenRecordSets` warning list returned by the save (link to each set).
- A channel without a template shows an empty state explaining that `$CMS_VALUE(recordset:…)$` renders
  nothing in that channel.
- Read-only for non-DEVELOPER roles and in time travel.

## Acceptance criteria

- [ ] Vitest specs: tabs per channel, dirty tracking across CDL + templates, diagnostics mapping, broken-set
      warnings rendered with links, read-only states.
- [ ] Saving an invalid record template keeps the editor content and shows the diagnostic at its line.
- [ ] `npm run build` green.

## Out of scope

- Per-set template overrides (epic open question).

## Notes / hazards

- If extracting the OCTL editor from `templates.component` touches `M20` inheritance code paths, keep
  `templates.component.spec.ts` green before and after the extraction (separate commit).
