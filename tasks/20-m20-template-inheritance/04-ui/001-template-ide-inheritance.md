---
id: M20.4.1
status: todo
depends: [M20.2.2, M20.3.1]
epic: m20-template-inheritance
feature: ui
area: fullstack
---

# M20.4.1 — Template IDE: abstract toggle, parent chain, inherited editors, live OCTL diagnostics

## Context

- `ui/src/app/features/templates/templates.component.html` edits CDL and each channel's OCTL in plain
  `<textarea>`s. CDL is validated live (`validateCdl`, `cdlDiagnostics` list); OCTL is not.
- `server/sf-api/.../api/OctlValidateController` (`POST /api/v1/projects/{key}/octl/validate`) calls
  `compile(source, channelKey, null)` with no `ReferenceResolver`, no content definition and no parent
  loader, so it returns only structural diagnostics.
- Page creation and template switching use the create-asset dialog
  (`shared/components/sf-create-asset-dialog.component.ts`) and the page editor's template picker.
- The UI has no Monaco (`ui/package.json`). This task stays on textareas.

## Goals

- **Backend: context-aware validation.** Extend `POST /octl/validate` with optional `templateUuid`
  (plus `contentDefinition` source for unsaved CDL). When present, compile with:
  - the project's live `ReferenceResolver`;
  - the live `ParentTemplateLoader` (M20.2.1);
  - the effective definition (own unsaved CDL + ancestors).

  It returns the same diagnostics a save would (0103, 0110, 0120, 0140–0149, SF-CDL-0107). Without
  `templateUuid` it keeps today's behavior. Regenerate OpenAPI + `schema.d.ts`.
- **Template screen (page templates):**
  - **Abstract** toggle. On 422 (template in use), show the page count and a link to the pages list
    filtered by template.
  - **Parent chain** breadcrumb (`base › docs_layout › article`), derived from `parentTemplateRef`,
    each link opening that template. Show children as "Extended by: …" (from usages, `TEMPLATE` kind).
  - **Inherited editors/bodies:** a read-only list above the own-CDL textarea, grouped by the ancestor
    they come from (`effectiveDefinition` + `inheritedFrom`).
  - **Live OCTL diagnostics** under each channel textarea, debounced, via the context-aware endpoint.
    Use the same presentation as `cdlDiagnostics`: line/col, message, "did you mean" suggestions
    where the problem includes them.
  - **Parent-save outcomes:** a 422 listing broken descendants renders each descendant uid as a link
    with its diagnostics. Descendant warnings from a successful save show as a dismissible notice.
- **Pickers:** exclude `abstract` page templates from the create-page dialog and the page editor's
  "change template" picker. The template list shows an "Abstract" badge.
- **Time travel:** every new control is disabled while `TimeTravelStore.isTimeTravel` is active,
  covered by the M15 read-only interceptor. The breadcrumb and inherited lists stay navigable.

## Acceptance criteria

- [ ] `OctlValidateController` API test: a `templateUuid` child using a parent-only editor returns no
      0103, the same source without `templateUuid` returns 0103, and a cycle returns 0144.
- [ ] Component specs:
  - [ ] Abstract toggle and 422 handling.
  - [ ] Breadcrumb from a three-level chain.
  - [ ] Inherited editors grouped by ancestor.
  - [ ] OCTL diagnostics rendered from a mocked validate response.
  - [ ] Broken-descendant 422 rendering.
  - [ ] Abstract templates filtered from the create-page dialog.
- [ ] Verified in the running app, per the `run` skill or memory notes: build `base` (abstract) →
      `docs_layout` (abstract) → `article` in the UI, create a page on `article`, and preview shows the
      layered output. A typo'd block name shows the `SF-TPL-0147` warning live.
- [ ] `ui` `npm run build` is green. `npm test` is green except for the known `templateUrl` runner
      issue; record which specs could not run.

## Out of scope

- Monaco / OCTL syntax highlighting / autocomplete. Recorded as a follow-up, not assumed here.
- Visual layout designer.

## Notes / hazards

- Debounce live validation (≥ 300 ms) and cancel in-flight requests (`switchMap`). A root layout with
  deep chains compiles several sources per keystroke burst.
- Unsaved CDL in the child must feed validation. Otherwise a developer who just added an editor sees
  a bogus 0103 until they save.
- Keep the inherited-editors list read-only. Editing a parent's editor from the child screen would
  silently change every sibling. Link to the parent instead.
