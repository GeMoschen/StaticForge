---
id: M21.4.1
status: done
depends: [M21.1.1, M21.3.1]
epic: m21-pagination
feature: ui
area: frontend
---

# M21.4.1 — `pagination-editor.component` + preview page selector

## Context

- The dynamic form engine lives in `ui/src/app/features/forms/`: `sf-content-form.component.ts`,
  `form-builder.service.ts` (`buildEditorControl`, `valueOf`), `editor-registry.ts`
  (`EDITOR_REGISTRY`), `editor-outlet.component.ts`, `form.model.ts`, with one component per type
  under `forms/editors/`. `reference-editor.component.ts` (asset picker via
  `sf-asset-picker-dialog`) and `catalog-editor.component.ts` are the closest precedents for a
  typed-object value.
- Pages are edited in `features/pages/page-editor.component.ts` with autosave
  (`autosave.service.ts`, `page-payload.util.ts`).
- Preview renders in `features/preview/preview.frame.component.ts`.
- Time travel is enforced by `TimeTravelStore.isTimeTravel` plus the readonly HTTP interceptor
  (`M15.5`).
- The visual diff resolves editors in `features/revisions/visual-diff/resolve-editor.ts`.
- API types come from `core/api/generated/schema.d.ts` (`npm run generate:api`).

## Goals

- `forms/editors/pagination-editor.component.ts`, registered in `EDITOR_REGISTRY` for
  `PAGINATION`. Types in `form.model.ts`; `buildEditorControl`/`valueOf` support in
  `form-builder.service.ts`.
- Controls:
  - **Source**: a kind toggle limited to the definition's `sources`. For `nav`, a picker that
    only allows navigation-store folders (reuse `sf-asset-picker-dialog` with a FOLDER +
    NAVIGATION-scope filter). The `dataset` picker is added once `M19.4.2` provides one; until
    then the kind is not offered.
  - **Page size**: number input bounded by `1..maxPageSize` (default `pageSize`).
  - **Sort**: select over the offered keys plus an ASC/DESC toggle.
  - A **Clear** action that sets the value to `null` (not paginated).
  - A read-only hint: "N items → M pages". Derive it from the preview `X-SF-Total-Pages` header
    for the current draft, or from a lightweight count call if one exists. Do **not** add a new
    backend endpoint only for this; drop the hint if no cheap source is available and note it.
- Client-side validation mirrors `M21.1.1` (required source when a kind is chosen, bounds), with
  server issues shown field-addressed like other editors.
- Preview page selector in the page editor's preview pane: shown only when the last preview
  response had `X-SF-Total-Pages > 1`. Prev/next buttons plus "Page n of N" select; it re-requests
  preview with `?page=n`. Links inside the preview iframe that carry `page=n` update the selector.
- The visual diff shows a `PAGINATION` value as "Source: <folder name> · 10 per page · date ↓"
  before/after.
- Accessibility: labelled controls, `aria-live` on the page indicator, and full keyboard
  operation (§24.7).
- Spec tests: `pagination-editor.component.spec.ts` (value round-trip, bounds, clear, sources
  filtering), a preview selector spec, and a `resolve-editor` summary spec.

## Acceptance criteria

- [x] A page whose template declares `editor pagination posts {…}` shows the editor. Choosing a nav
      folder, size 5 and sort `date DESC` autosaves the exact stored value shape from `M21.1.1`.
- [x] Only offered sources and sort keys are selectable; page size can't exceed `maxPageSize`.
- [x] The preview pane shows the page selector for a paginated page with >1 pages, and switching to
      page 2 renders page 2.
- [x] In time travel, the editor and the Clear action are disabled; the page selector still works
      (it is read-only navigation).
- [x] The visual diff of a revision that changed page size shows a readable before/after.
- [x] `ui` `npm run build` green; new specs pass (or, if the known `templateUrl` spec-runner
      environment issue persists, the specs are written with inline templates or the limitation is
      recorded with evidence as in `M15`).

## Out of scope

- The dataset source picker (lands with `M19.4.2`; wire it in then).
- Editing the template's `paginationPath` in the template IDE. The page template's per-channel
  path patterns are edited wherever `outputPath` is edited today; add the field there only if
  that UI exists, otherwise leave it API-only and note it.

## Notes / hazards

- The UI spec runner currently fails for `templateUrl` components in this environment (see
  `M15` exit criteria and project memory). Prefer inline templates for small new components, or
  record the limitation rather than claiming green.
- The picker must not offer the hidden shared `root` folder or page-store folders. The
  `nav:root` → `navigation_root` alias bug fixed earlier is the precedent for scope mistakes.
