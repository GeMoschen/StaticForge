---
id: M25.6.1
status: done
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

- [x] Every example in the new doc sections is covered by a golden file or test (link them in the doc
      source as comments, as `M19.5.1` did).
- [x] All new diagnostic codes documented; `grep` over `DiagnosticCodes` vs. docs shows no gaps.

## Out of scope

- Screenshots/video.

## Implementation notes (2026-09-23)

- **Developer guide** (`docs/template-developer-guide.md`). §2.9 gained four sub-sections after the M19 material:
  *Record sets (M25)* (containment and `SF-DOM-0104`, cascade delete, the stored query with a table of its three
  differences from loop arguments — bare names, no render scope, no `folder` —, save-time `SF-TPL-0140/0141/0142`,
  render-language evaluation, rename rewrite / `brokenRecordSets` / `SF-GEN-0240`), *Record templates (M25)* (scope
  names, "everything a section template can do", `SF-TPL-0122`, channel keys and `SF-GEN-0241`, the rename rule),
  *Rendering a set (M25)* (value form, no re-escaping, root value object, empty cases, `SF-TPL-0135` cycles, Markdown,
  loop narrowing order, `reference` editor forms incl. the render-time `SF-TPL-0141` warning, generation == preview,
  `dataset:` loops unchanged) and *Incremental builds with record sets (M25)* (the earlier agent's "Rebuilds with
  record sets" paragraph moved here and extended with a change → rebuild table, the conservative `reference`-editor
  rule, the insight labels and the `recordsInSetsRenderedByPages` benchmark numbers). §2.1 gained the `dataset:`,
  `recordset:` value and loop rows; §2.5 the record-template scope; §2.6's prose list became a **prefix table**
  (`page` … `recordset`, `dataset`, `nav`; `record_set` is not a spelling) with each root value object. Part 3: rows
  `0103`, `0105`, `0112`, `0135`, `0140`, `0141` (render-time warning for unrestricted reference loops), `0142`
  amended; `0122`, `SF-GEN-0240/0241` were already there. Part 4 lists the new golden directories.
- **Golden coverage.** Ten new pinned snippets (`<!-- golden: … -->`, checked by `DocsGoldenSnippetsTest`):
  `render/recordset-value/{records.json,template.octl,expected.html}`,
  `render-md/recordset-value-markdown/{template.octl,expected.md}`,
  `render/recordset-loop-narrowing/{template.octl,expected.html}`,
  `render/recordset-reference-editor/{template.cdl,template.octl,expected.html}`; `recordset-l10n` is referenced in
  prose. Statements without a fenced example carry `<!-- Tests: … -->` comments naming the tests that prove them.
  Gradle was off-limits for this task, so the test's regex and comparison were re-run in a script: 23/23 pinned
  snippets equal their golden files (13 existing + 10 new); **`DocsGoldenSnippetsTest` itself still has to run.**
- **Diagnostic check.** Every string constant in `DiagnosticCodes` (54) has a catalogue row in the guide (the
  test's second method, re-run in the script). New M25 codes from `git diff master` over `server/`: `SF-DOM-0104`
  (api.md §15, guide §2.9 prose), `SF-TPL-0122`, `SF-GEN-0240`, `SF-GEN-0241` (guide Part 3 + api.md) — no gaps.
  Pre-M25 gaps found by the same grep, left alone (not this milestone): `SF-GEN-0202`–`0206`, `0501`–`0503` are in
  neither doc; `SF-GEN-0411`/`0412` are missing from `docs/api.md`.
- **`docs/editors/reference.md`**: `RECORD_SET` in `assetTypes`, the `dataset` attribute's exact record/set rule
  (checked against `ContentValidator.validateDataset`: without `assetTypes` only records; `RECORD_SET` must be named
  for sets), a *Record sets (M25)* section with the golden CDL and template (same golden markers; that file is not
  scanned by the test, its snippets were diffed against the golden files). `docs/editors/README.md`: the `dataset`
  finding row.
- **`docs/user-guide.md`**: *Content* rewritten around record sets — tree and set list, creating a set and choosing
  its dataset (immutable), the **Set query** panel (Where / sort keys / Offset / Limit, live "N of M records match ·
  the set shows K", Save query / Revert, broken sets show nothing), the grid's **All records** (dimmed) vs **Show as
  rendered**, **Use as set query**, the template snippet, record **Move…**, cascade delete/restore, picking sets in a
  page, time travel, roles. Search kinds and indexed text gained record sets; *Why is this rebuilding?* the three new
  reasons (labels from `insight.util.ts`). UI strings were taken from the components.
- **`cms-specification.md`**: §3 glossary (asset list/types, dataset record templates, **Record set**, record's
  parent), §5.1 type list + a Content-store containment diagram and rules, §5.4 `TEMPLATE`/`OCTL_VALUE` rows, §16.2
  `recordset:` value and loop rows, §16.4 prefix list and root value objects (`record`, `recordset`, `dataset`), §16.5
  record-template scope, §18.2 the three new edges, §20.2 a *Datasets, record sets and records* endpoint block
  (pointing at `docs/api.md` §6.2–6.3), §26.5 export protocol 7 and the import conflicts.
- **Breaking-change note**: `docs/release-readiness.md` §4 *Release notes — breaking changes* (containment,
  `recordSetUuid` request, no migration → reset dev databases, protocol 7 and `RECORD_OUTSIDE_RECORD_SET`, `dataset:`
  loops unchanged), with the proving tests.
- **`docs/api.md`** (record-set endpoints, changed record create request) was already complete from the earlier tasks
  and is owned by another agent — not edited. `docs/architecture.md` needed no change.
- **Findings for other lanes (not fixed here — UI code is out of scope):**
  - The reference picker offers record sets for `dataset "uid"` with an empty `assetTypes`
    (`asset-picker.util.pickerTypeOptions`), but the server accepts only records there
    (`ContentValidator.validateDataset`), so such a pick fails with a `dataset` ERROR finding.
  - The import screen still disables Proceed on any `BLOCKING` conflict (`project-settings-import.component.ts`
    `hasBlocking`), so a pre-M25 archive with records can't be committed from the UI although the server imports
    everything but the rejected records; it should gate on `blocksImport` (noted by `M25.4.1`, still open).

