---
id: M25.2.1
status: todo
depends: [M25.1.1]
epic: m25-record-sets
feature: rendering
area: backend
---

# M25.2.1 — Per-channel record templates on `DATASET`

## Context

Section templates store OCTL per channel under `payload.channelTemplates.<channel>` and compile on save
(`TemplateServiceImpl`, compile cache `M16.1`, reference rows with source path
`channelTemplates.<channel>` `M16.3.2`). A `DATASET` today is CDL only (`SF-CDL-0108` rejects `bodies`).
Epic decision 4 is binding.

## Goals

- `DATASET` payload gains optional `channelTemplates.<channelKey>` (OCTL source). `CreateDatasetCommand` /
  `UpdateDatasetCommand` carry them; unknown channel keys are rejected like on section templates.
- Compile on save with the dataset's own definition as the local scope: record fields are top-level
  names (`$CMS_VALUE(name)$`), plus `_uid`, `_uuid`, `_displayName`, `_recordSet`, and the per-render loop
  meta `_index`, `_first`, `_last`, `_count`. Unknown names are the usual unknown-editor diagnostic;
  `SF-TPL-0310` (declared but unused) is **not** raised for datasets. `$CMS_EXTENDS$`, `$CMS_BODY$` and
  `$CMS_BLOCK$` are errors in a record template (new `SF-TPL-*` code).
- Write template OCTL reference rows for record templates exactly like section templates (so usages and
  the planner see `$CMS_REF`/`$CMS_VALUE(page:…)$` inside them).
- Compiled record templates go through the existing compile cache, keyed like section templates.
- `renamedFrom` on the dataset schema rewrites field names in its own record templates in the same
  revision **only if** section templates get the same treatment today; otherwise the save reports them as
  diagnostics like a section template would — check `TemplateServiceImpl.migrateRenames` and mirror it.

## Acceptance criteria

- [ ] Create/update a dataset with an `html` and `md` record template; a template reading an undeclared
      field is rejected with a diagnostic pointing at line/column; `$CMS_BODY(x)$` is rejected.
- [ ] Reference rows for a record template's `$CMS_REF(page:home)$` appear under `channelTemplates.html`
      and show up in `page:home`'s usages.
- [ ] Datasets without record templates keep saving and rendering exactly as in `M19` (regression).

## Out of scope

- Rendering a set through the template (`M25.2.2`); the editor UI (`M25.5.2`).

## Notes / hazards

- Keep the "schema is CDL, no bodies" rule (`SF-CDL-0108`): record templates are *OCTL next to the CDL*,
  not CDL `bodies`.
