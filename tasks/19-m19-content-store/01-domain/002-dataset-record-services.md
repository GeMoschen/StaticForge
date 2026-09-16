---
id: M19.1.2
status: done
depends: [M19.1.1, M16.3.1, M16.5.2]
epic: m19-content-store
feature: domain
area: backend
---

# M19.1.2 — `DatasetService` / `RecordService` with validation, references and rename migration

## Context

Section templates already compile CDL on save (`TemplateServiceImpl.compileDefinition`, 422
`SF-API-0422` with diagnostics) and store `contentDefinition` + `compiledDefinition` in the payload.
When an editor is renamed via `renamedFrom`, `TemplateServiceImpl.migrateRenames` /
`migratePagePayload` (§12.3) rewrites every affected page's payload inside one revision. After
`M16.5.2` a `ContentValidator` runs on page/section save; after `M16.3.1` content references
(`ContentReferenceService`) are written and closed on save rather than only at generation.

## Goals

- `DatasetService` (`sf-domain/.../asset/dataset/`), `@RevisionAware`, taking `RevisionContext`:
  - `create(ctx, CreateDatasetCommand{displayName, folderUuid, contentDefinition, titleEditor?, description?})`,
    `update(...)`, `softDelete`, `restore`.
  - Compile CDL with `CdlCompiler`; reject `body` declarations with a new diagnostic
    (next free `SF-CDL-*` code in `DiagnosticCodes`, e.g. `SF-CDL-0110` "bodies are not allowed in a
    dataset schema"); store `contentDefinition`, `compiledDefinition`, `titleEditor`, `description`.
  - `titleEditor` (optional): name of a `text` editor whose value, when set, becomes the record's
    display name on save (UID derivation per §6.3 only on create, never silently renamed afterwards).
  - Soft-deleting a dataset that still has non-deleted records → 409 with the record count (no
    cascade in v1).
- `RecordService` (`asset/dataset/`), `@RevisionAware`:
  - `create(ctx, CreateRecordCommand{datasetUuid, displayName?, folderUuid, content})`,
    `update(ctx, uuid, content, ifMatchRevision)`, delete/restore/move via the generic `AssetService`
    paths (no duplicate logic).
  - `datasetRef` is immutable after create (moving a record to another dataset = create + delete).
  - Validate `content` against the dataset's compiled definition with the `M16.5.2` validator, same
    error/warning semantics as pages.
  - Materialize references on save (`ContentReferenceService`, per `M16.3.1`), plus a
    `ReferenceKind.TEMPLATE` edge record → dataset (the enum value exists and is unused today) so
    usages and the planner can walk it.
- Schema rename migration: when a dataset update contains `renamedFrom` renames, open a batch
  (`beginBatch`), update the dataset, and rewrite `content` keys of every current record of that
  dataset through `allocateOrJoin`, appending each to the summary — one revision total.
  Extract the key-renaming logic shared with `TemplateServiceImpl.migratePagePayload` into one
  helper (e.g. `ContentRenameMigrator`) instead of copying it; pages keep byte-identical behavior.
- Authorization intent documented for `M19.2.1`: dataset writes DEVELOPER, record writes EDITOR,
  reads VIEWER.

## Acceptance criteria

- [x] Integration tests: create dataset (valid CDL / CDL error → 422 with diagnostics / `body` → new
      diagnostic); create/update record (valid, invalid → validator errors, `If-Match` conflict → 409).
- [x] Renaming an editor with `renamedFrom` on a dataset with 3 records produces **one** revision whose
      `summary.assets` lists the dataset and all 3 records, and every record's content uses the new key.
- [x] Existing `TemplateServiceTest` rename tests pass unchanged after the helper extraction.
- [x] Record → dataset `TEMPLATE` edge and content references exist right after save (no generation run).
- [x] Deleting a dataset with live records → 409; after deleting the records → allowed.
- [x] `titleEditor` sets display name on create and update; UID only derived on create.

## Out of scope

- REST controllers (`M19.2.1`), OCTL usage (`M19.3.2`), export/import (`M19.1.3`), bulk record
  operations, record ordering by drag-and-drop (sorting is query-driven).

## Notes / hazards

- **Compound revision size.** A rename on a 5,000-record dataset rewrites 5,000 versions in one
  transaction. Measure it; if it is too slow, batch the JDBC writes but keep one revision (do not
  split into several revisions — that breaks the `M15` contract).
- Removed editors: follow what `migratePagePayload` does today for pages (values retained or dropped)
  — do not invent different semantics for records.
- Concurrency: a record edit racing a schema migration must surface as the normal `If-Match` 409, not
  silently lose the rename; cover with a test.
- If `M17.1.2` created a reusable "CDL-backed asset" helper (compile + validate + references), use it.

## Implementation notes (2026-09-16)

- `asset.dataset`: `DatasetServiceImpl` compiles with `DatasetCdlRules` (`SF-CDL-0108` for bodies); `titleEditor`
  must name a `text` editor. `RecordServiceImpl` validates with `ContentValidator` (structural → 422 `issues`,
  completeness findings returned with the save) and derives the display name from the title editor; the uid is
  derived on create only.
- **Rename migration:** no extraction from `TemplateServiceImpl` was needed — values are rewritten by the existing
  `ContentRenameMigrator`; `RecordRenameMigration` (`@RevisionAware`, `Propagation.MANDATORY`) walks the dataset's
  records in chunks of 200 with `EntityManager` flush/clear and appends one summary. 1,000 records: 21 s before
  chunking, 3 s after; 5,000 records: 9 s, one revision.
- `ReferenceMaterializer`: RECORD → `TEMPLATE` edge to its dataset plus content refs; DATASET has none.
  `softDelete` refuses a dataset with live records even with `force` (`SF-DOM-0121`, `recordCount`).
- A `reference` editor may declare `dataset "uid"`; `RecordDatasetLookup` makes a value outside the dataset a
  structural `dataset` finding.
- Tests: `DatasetRecordIntegrationTest` (rename in one revision, racing edit is a conflict, validation, dataset
  restriction, delete guard, title editor, move/restore through the generic paths).
