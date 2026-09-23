---
id: M25.6.1
status: todo
depends: [M25.2.2, M25.4.1, M25.5.1]
epic: m25-record-sets
feature: docs-e2e
area: qa
---

# M25.6.1 — Documentation and spec follow-up

## Context

`docs/template-developer-guide.md` §2.9 documents datasets and records (`M19`); `docs/editors/reference.md`
documents `assetTypes` and `dataset "uid"`; `docs/user-guide.md` covers the Content store; `docs/api.md`
lists endpoints; diagnostics tables live in Part 3 of the developer guide.

## Goals

- Developer guide: new §2.9 sub-sections "Record sets" (containment, stored query grammar and its
  differences from loop `where`), "Record templates" (scope names, channels, no `$CMS_EXTENDS$`),
  "Rendering a set" (`$CMS_VALUE(recordset:uid)$`, root value object with `records`/`_count`, loop form and
  narrowing order, reference-editor forms), "Incremental builds" (what rebuilds what); update the §2.6
  root-value-object list and the prefix table; add every new `SF-*` code to Part 3.
- `docs/editors/reference.md`: `RECORD_SET` in `assetTypes`, `dataset` restriction for sets, rendering
  examples.
- `docs/user-guide.md`: creating sets, choosing a dataset, editing the set query, "Show as rendered".
- `docs/api.md`: record-set endpoints, changed record create request.
- `cms-specification.md`: §3 glossary (record set), §5.1 diagram, §16.2 instruction table, §20.2 endpoints,
  §26.5 protocol 7 note.
- Breaking-change note (release notes section or `docs/release-readiness.md`): records must live in a
  record set; records created before `M25` are **not** migrated (reset dev databases), and pre-`M25`
  archives import without their records (`RECORD_OUTSIDE_RECORD_SET`).

## Acceptance criteria

- [ ] Every example in the new doc sections is covered by a golden file or test (link them in the doc
      source as comments, as `M19.5.1` did).
- [ ] All new diagnostic codes documented; `grep` over `DiagnosticCodes` vs. docs shows no gaps.

## Out of scope

- Screenshots/video.
