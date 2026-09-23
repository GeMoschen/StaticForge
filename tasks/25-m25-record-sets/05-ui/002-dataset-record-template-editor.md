---
id: M25.5.2
status: done
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

- [x] Vitest specs: tabs per channel, dirty tracking across CDL + templates, diagnostics mapping, broken-set
      warnings rendered with links, read-only states.
- [x] Saving an invalid record template keeps the editor content and shows the diagnostic at its line.
- [x] `npm run build` green.

## Out of scope

- Per-set template overrides (epic open question).

## Notes / hazards

- If extracting the OCTL editor from `templates.component` touches `M20` inheritance code paths, keep
  `templates.component.spec.ts` green before and after the extraction (separate commit).

## Implementation notes (2026-09-23)

- **Extraction (shared editor).** The Templates store's channel editor (textarea + diagnostics list, previously
  inline in `templates.component.html`) is now `shared/components/sf-octl-editor.component` (`SfOctlEditorComponent`):
  stateless (`value`/`valueChange`, `diagnostics`, `readOnly`, `label` = the textarea's accessible name), each
  positioned diagnostic's `(line:column)` is a button that moves the caret there (`offsetForPosition` from
  `media/text-media.util`, the M18 drawer's helper), and `insert(snippet, caret)` puts a snippet at the caret.
  `TemplatesComponent` uses it for the channel source; the only behaviour change there is that the channel
  textarea is now `readonly` in time travel (it was editable but unsavable). `onChannelInput` takes the source
  string instead of an `Event` (one call in `templates.component.spec.ts` adapted); the spec was green before and
  after. No `M20` inheritance code path was touched. The M20/M21 Playwright journeys' selectors
  (`textarea[aria-describedby="octl-diagnostics"]`, `#octl-diagnostics`) now use the editor's accessible name
  (`OCTL source for channel …`) and `sf-octl-editor .octl-editor__diagnostics`.
- **Tabs.** `DatasetSchemaEditorComponent` has a tab list: "Schema (CDL)" (the former panel: CDL, its diagnostics,
  title field, loop snippet, Validate) and one "Record template (<channel>)" per **enabled** channel in channel
  order (`GET /channels`), plus disabled channels that still hold a stored template (marked "disabled", with a
  notice), so saving never drops a template unseen. Tabs show an error-count badge and an "(unsaved)" marker.
- **Empty state.** A channel without a (non-blank) template explains that `$CMS_VALUE(recordset:…)$` and a
  reference editor pointing at a set of this dataset render nothing there, and that `$CMS_FOR` over a set is not
  affected. Developers get the empty editor below it; read-only users only the explanation.
- **Insert helpers.** Chips for the fields and the meta names `_uid`, `_displayName`, `_index`, `_first`, `_last`,
  `_count` insert at the caret: `$CMS_VALUE(name)$`, and `$CMS_IF(_first)$…$CMS_END_IF$` (caret inside) for the two
  flags. Fields come from the **CDL being edited** (a small scanner in `record-template.util.ts`: editors directly
  in `content { }` or a `group "…" { }` wrapper — not a `list`'s `item { }` — mirroring `ContentDefinition.findEditor`),
  so a field added in the same save is offered at once; labels come from the saved compiled definition.
- **Save.** One `PUT /datasets/{uuid}` with the schema fields and `channelTemplates` = every non-blank source (the
  map replaces the stored templates; blank = removed, like the server). Save is gated on dirty (schema fields or any
  template differs from the stored dataset; a blank template equals none) and on not already saving.
  Response: `recordTemplateDiagnostics` are shown per channel tab (warnings), `brokenRecordSets` as a dismissible
  notice listing each set with its query diagnostics and a link to `content/sets/:setUuid`.
  `422` with `channel` (`channelDiagnostics`): nothing is reloaded — the edited sources stay, the failing
  channels' diagnostics are shown in their tabs, the first failing channel opens and the caret moves to its first
  positioned error (`afterNextRender`). `422` with only `diagnostics` = schema errors under the CDL (schema tab opens).
  `409` reloads as before; other errors toast the problem `detail` (e.g. `field: channelTemplates.<key>`).
- **Live check while typing (addition).** The open template is checked with the structural `POST /octl/validate`
  (no `templateUuid` — the context-aware mode only knows page/section templates), debounced 300 ms, answers applied
  only to the channel/source they were asked for; a save drops a pending check. Field names are checked by the save
  (the schema being saved is the scope) — no server change was needed or made.
- **Read-only.** Non-DEVELOPER roles and time travel (dataset read at the revision): templates shown `readonly`, no
  insert helpers, no live validation, Save disabled (existing role/time-travel rule of the component).
- **New files.** `shared/components/sf-octl-editor.component.{ts,html,scss,spec.ts}`,
  `features/content/record-template.util.{ts,spec.ts}`, `features/content/dataset-schema-editor.component.spec.ts`.
  `schema.d.ts`/OpenAPI unchanged. No new build warnings (the dataset editor's SCSS stays under the 4.1 kB budget).
- **Manual check not done in this lane** (needs `gradlew bootRun`; a backend agent held Gradle) — left to the
  coordinator / `M25.6.2` journey.
- **Tests.** `record-template.util.spec` (7: source read, save map/dirty compare, tab list incl. disabled-with-template,
  CDL field scan incl. group/list/strings with braces, meta helpers, 422 error parsing, first positioned error),
  `sf-octl-editor.component.spec` (4: edit output, diagnostics + jump, insert with caret, read-only),
  `dataset-schema-editor.component.spec` (10: tabs per channel, empty state, dirty tracking across CDL + templates
  and the one-request payload with `If-Match`, rejected template keeps content + diagnostic at its line + caret,
  schema 422 to the CDL tab, broken sets with links + warnings + dismiss, insert helpers, live check per channel,
  read-only for EDITOR, read-only in time travel). `npx vitest run` 441/441 (incl. the parallel M25.5.3 lane's specs),
  `npx ng build` green.

### Follow-up (2026-09-23) — field-aware live check
- `POST /octl/validate` gained `datasetUuid` (with the existing optional `contentDefinition` = the unsaved dataset
  CDL): `DatasetService.validateRecordTemplate` compiles the source with `OctlCompiler.compileRecordTemplate` against
  the draft (or stored) schema through the save's resolver, so undeclared fields (`SF-TPL-0103`) and `SF-TPL-0122`
  are reported while typing — the diagnostics a save would give. `templateUuid` + `datasetUuid` is `422`, an unknown
  dataset `404`, role `DEVELOPER` as before. OpenAPI / `schema.d.ts` regenerated.
- The editor's live check sends `datasetUuid` and the CDL being edited; an answer is applied only while both the
  source and the CDL are unchanged. Opening a template tab re-checks it, so a field added on the CDL tab clears its
  `SF-TPL-0103` without retyping. This replaces the "structural only" note above.
- Tests: `DatasetApiTest.theRecordTemplateLiveCheckKnowsTheDatasetsFields` (unknown field with position, draft CDL
  declaring it, `0122`, plain mode unchanged, `422`s, `404`, `403` for EDITOR); `dataset-schema-editor.component.spec`
  (request body; field check against the edited CDL and re-check on tab open).
