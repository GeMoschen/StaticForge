---
id: M17.4.1
status: done
depends: [M17.2.1]
epic: m17-global-store
feature: ui
area: frontend
---

# M17.4.1 — Globals store: nav rail, tree, values form, schema editor, export picker

## Context

- **Store precedent.** `ui/src/app/features/navigation/` (component, service, tree node,
  folder/reference detail) was added in `M8.1.6`. Routes live in `ui/src/app/app.routes.ts`
  (`p/:projectKey/media|navigation|templates`). Nav rail entries are in
  `ui/src/app/features/dashboard/nav-rail.component.ts` (~lines 50–52).
- **Form engine.** `ui/src/app/features/forms/sf-content-form.component.ts` (inputs
  `definition`, `formGroup`, `projectKey`) plus `form-builder.service.ts`
  (`buildEditorControl`/`buildRowGroup`/`valueOf`). It's used by
  `pages/page-editor.component.ts` and `section-editor.component.ts`.
- **CDL editing.** `features/templates/templates.component.html` edits CDL in a plain
  `<textarea>` with `validateCdl` → `cdlDiagnostics`.
- **Creation and pickers.** `shared/components/sf-create-asset-dialog.component.ts` (union
  `CreateAssetKind`), `sf-asset-picker-dialog`, `tree-sort.util.ts`, `tree-clipboard.service.ts`.
- **Time travel.** `TimeTravelStore.isTimeTravel` plus the `M15.5.1` read-only HTTP
  interceptor and `M15.5.2` per-surface disabling.
- **Export picker.** `features/settings/project-settings-export.component.ts` has
  store-specific branches.

## Goals

- **Routing and nav rail.** Add `p/:projectKey/globals` (lazy standalone component) and a
  nav rail entry "Globals" between Navigation and Templates, with a Material icon such as
  `tune`.
- **`GlobalsService`** (API client from the regenerated `schema.d.ts`): list, get (with
  `revision` for time travel), create, update schema, update content, delete. Folder calls
  reuse the existing folder client with `scope=GLOBALS`.
- **`GlobalsComponent`.** A folder tree (reuse the navigation/media tree node components or
  their shared base, not a copy) with create folder / create set / rename / move / delete,
  and clipboard + sort through the existing utils with a `GLOBAL_SET` case added.
- **`GlobalSetDetailComponent`** with two tabs:
  - **Values:** `sf-content-form` bound to `compiledDefinition`, with an explicit Save
    (not autosave) that sends `If-Match`. On 409, open the existing conflict drawer / reload
    flow used by the page editor. Field-level 422 issues from the server show on the
    matching controls. Disabled for `VIEWER`.
  - **Schema:** CDL textarea with live diagnostics via `cdl/validate` (with
    `kind=GLOBAL_SET` if `M17.2.1` added it), and Save. After a schema save, the Values tab
    re-renders from the new definition, keeping values the server migrated. Disabled
    below `DEVELOPER`.
  - A header with uid (copy button), a usage snippet (`$CMS_VALUE(CMS_GLOBAL.<uid>.…)$`
    with click-to-copy), and a usages link.
- **Create dialog.** Extend `CreateAssetKind` with `GLOBAL_SET` (display name → uid
  preview, initial CDL template with one example editor).
- **Time travel.** Every write control is visibly disabled and the tree mutations are
  hidden or disabled while `isTimeTravel()`. Detail loads use `?revision=`.
- **Export picker.** Add a Globals store section with a "whole store" checkbox
  (`fullStores: GLOBALS`) and folder/set selection.
- **Specs.** `globals.service.spec.ts` (pure, runnable), `global-set-detail.component.spec.ts`
  (role gating, 409 path, time-travel disabling), and an export picker spec update.

## Acceptance criteria

- [ ] The nav rail shows Globals, and the route loads the store tree for the project.
- [ ] A developer can create set `site`, write CDL with errors (diagnostics shown inline,
      Save disabled or rejected with diagnostics), fix it and save.
- [ ] An editor sees the Schema tab read-only and can edit and save values. A 422 shows
      field errors, and a 409 opens the conflict flow.
- [ ] A viewer sees both tabs read-only.
- [ ] During time travel, all controls are disabled and the detail shows the historical
      schema and values.
- [ ] Export picker: selecting the whole Globals store sends `fullStores` including `GLOBALS`.
- [ ] Keyboard: tree navigation, tab switching and save are operable without a mouse, with
      visible focus (§24.7).
- [ ] `ui` `npm run build` green. New specs are written, and non-`templateUrl` specs pass;
      `templateUrl` specs are subject to the known runner issue (document in the task when done).

## Out of scope

- A Monaco/CodeMirror CDL editor. The plain textarea stays, as in the templates screen.
- Locale switching in the Values tab (`M24.4.1`).
- Showing globals in the global search / command palette (`M23`).

## Notes / hazards

- Don't fork the page editor's form wiring. If `page-editor.component.ts` holds reusable
  logic inline (definition conversion `toDefinition`, 422 issue mapping), extract it to a
  shared helper both use, rather than copying.
- The Values form must be rebuilt, not patched, when the definition changes after a schema
  save. Reusing a `FormGroup` across definitions leaves orphan controls behind.
- Check the time-travel interceptor's allow-list: a new mutating endpoint needs no
  registration if the interceptor blocks by HTTP method, but verify it rather than assuming.

## Implementation notes (2026-09-16)

- **Tree:** decided with the user to build a shared `shared/components/sf-store-tree-node` and migrate the
  Navigation store onto it (its `nav-tree-node` copy is deleted). Media, Templates and Pages still use their own
  tree nodes.
- **409:** the Values/Schema save reloads the set instead of opening the page editor's conflict drawer (the
  `M17.2.1` note: "reload after a 409 instead of retrying blindly"). A set's save is explicit, not autosaved, so
  there is no pending draft to merge field by field.
- **Specs:** `globals.service.spec.ts` (11) runs and passes. `global-set-detail.component.spec.ts` (9) and
  `sf-store-tree-node.component.spec.ts` (5) are written and fail to resolve `templateUrl`, like every component
  spec in the repo. UI suite before M17: 18 failed files / 68 failed / 116 passed tests. After: 19 / 78 / 127.
  That is +11 passing service tests, +14 new component tests failing on `templateUrl`, and −4 from the deleted
  `nav-tree-node` spec. No previously passing test fails. Tried and reverted: wiring `@analogjs/vite-plugin-angular` into `vitest.config`. It needs an ESM
  config (`.mts`) and a plugin version that matches Vite 5 (`1.13.1`; the hoisted `1.22.5` needs Vite 6). With
  both, `templateUrl` resolves, but `TestBed` then reports "Need to call TestBed.initTestEnvironment() first" with
  either the hand-rolled zone setup or `@analogjs/vitest-angular/setup-zone`. Fixing the runner is its own task.
- **Behaviour is proven live instead:** `ui/e2e/m17-journeys.spec.ts` 4/4 against a dev backend + `ng serve`
  (see `M17.5.2`).
