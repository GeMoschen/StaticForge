---
id: M35.13
status: done
depends: [M35.10]
epic: m35-ui-ux-overhaul
feature: frame
area: frontend
---

# M35.13 — Save UX, unsaved-changes guards, confirm and undo

## Context

- **Autosave:** `shared/services/autosave.base.ts` (page and record editors).
- **Explicit Save:** templates, global sets, dataset schema, navigation reference, media drawer, account, quality and
  settings.
- There is no `canDeactivate` and no `beforeunload`.
- 29 `window.confirm` calls and one `window.prompt`.
- Backend: `POST /assets/{uuid}/restore`, move endpoints.
- User decisions 10 and 11.

## Goals

- **`EditorStateService` contract**, implemented by every editor: `dirty`, `saving`, `lastSaved`, `error`, `save()`,
  `discard()`.
- **`sf-save-status`** in the page header: "Saved 12:04", "Saving…", "Unsaved changes", "Not saved — 2 errors". It
  lives in an `aria-live` region.
  - Explicit-save editors show a primary *Save* that is enabled only when dirty.
  - Autosave editors show only the status, plus "Save now" in the overflow menu.
- **`Ctrl/Cmd+S`** is global: it saves the active editor, or flushes autosave. It is registered through
  `ShortcutService`, not per component.
- **Guards:**
  - A `canDeactivate` guard for every editor route.
  - An in-app dialog: "Save", "Discard", "Cancel" (save failures keep the user on the page).
  - `beforeunload` while dirty or while an autosave is pending.
  - Switching items inside one screen (templates tree, globals, navigation) goes through the same check.
- **Undo:** `UndoService.offer(label, undoFn)` shows a toast with *Undo*. It is used for:
  - delete (restore through `/restore`)
  - move (move back)
  - rename (rename back)
  - bulk variants of these, which undo as a group
- **Confirm:** all confirmations go through `ConfirmService` (M35.7). Large deletes need a typed confirmation. The
  screen tasks replace the `window.*` calls; this task provides the service wiring and replaces the calls in shared
  code.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Decisions (user, 2026-10-02)

- **Wiring scope:** infrastructure (contract, `sf-save-status`, global Ctrl+S, guards, `UndoService`, unsaved dialog)
  plus the **page, record and template** editors. The other explicit-save editors (global sets, dataset schema,
  navigation reference, media drawer, account, quality, settings) are wired by their screen tasks; their element-scoped
  Ctrl+S keeps working until then.
- **Undo for every delete / move / rename that exists** (pages, content, navigation, media, templates; single and bulk).
  Backend additions (agent): restore of a deleted **folder with its subtree**; restore for **templates**; undo for **page
  section** deletes and **UID changes**.
- **Large deletes:** 25+ items need the word `delete` typed.
- **Autosave leave:** flush silently, block (dialog) only when the save fails or conflicts.
- **Sample first:** save status, leave dialog, Save now and the undo variants are in the sample (gate round 3); the app
  part waits for sign-off.

## Acceptance criteria

- [x] Vitest: guard on route change and in-screen switch, `beforeunload` registration, `Ctrl+S` routing, undo for
      delete/move/rename (mocked API), and a failed undo shows an error toast.
- [x] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- A reload after a save must not take back newer edits (`tasks/lessons.md`, 2026-09-30).
- Restoring a deleted asset may fail if its folder was deleted too. Undo the group in reverse order.

## Notes (M35.9)

- The sample shows the intended look: `sf-page-header` with the save status beside the actions, destructive actions in
  the ⋮ menu with a typed confirmation for large ones, and undo through `sf-toast`. Reuse these; don't add new
  patterns.
- Release actions are a group of their own in the header (decision 34); `sf-save-status` sits before that group.

## Review (2026-10-02)

Built as signed off (gate decisions 47–51). `npx vitest run` 250 files / 2,168 tests, `npx ng build` and `npm run lint`
green; backend suites green (one failure, `ReleaseApiTest` search by `releaseStatus=CHANGED`, fails the same on a clean
master). Checked in Chrome against a seeded backend: template edit → *Unsaved changes* pill, Ctrl+S saves (*Saved 12:43*),
switching template with edits opens the dialog, closing the tab prompts (`beforeunload`), page delete → *Undo* restores it.

- **Contract and frame** (`core/editor/`): `EditorStateService` (name, dirty, saving, lastSaved, error, autosave,
  save(), discard()); `ActiveEditorService` — registry, Ctrl/Cmd+S through `ShortcutService` (Shift forbidden), the leave
  check (`canLeave`: autosave editors flush silently, only a failed write asks; explicit editors ask), `beforeunload`;
  `unsavedChangesGuard` on `pages/:uuid`, `content/records/:recordUuid`, `templates` (fires on a changed param too, not on
  a changed query); `autosaveEditorState` adapter. `AutosaveService.flush()` now returns a promise, has `hasPending` and
  `discardPending()`, and no longer listens for Ctrl+S itself. `ShortcutService` supports `shift: false`.
- **Shared UI:** `sf-save-status`, `UnsavedChangesService` + dialog, `UndoService` (single and group undo, error toast on a
  failed undo), `typeToConfirmFor` (25+ → `delete`).
- **Editors wired:** page editor, record editor (both autosave) and templates (explicit save, `TemplatesSaveCoordinator`
  `saveAsync` / `discardEdits`; switching a template or folder asks first).
- **Undo wired** (agents; specs per area): delete, move, rename and bulk for pages, folders, content (records, sets,
  datasets), globals, templates and folders, navigation, media files and folders; page section delete; UID change
  (`sf-uid-rename` opt-in `undoable`); tree rename (`sf-store-tree-node` opt-in `undoable`). Backend: folder-subtree
  restore, template restore, section re-insert, uid round trip.
- **No undo:** removing a locale file of a media item (no endpoint), section moves between pages/bodies, redirects written
  after a page delete, replacing a file's content.
- **Deviations / open:**
  - The page editor header has no overflow menu yet, so *Save now* is not there (Ctrl+S and the status cover it until
    M35.18); the record editor keeps its *Save now* button until M35.20.
  - Global sets, dataset schema, nav reference, media drawer, account, quality and settings are not registered editors:
    they keep their own Ctrl+S / confirms until their screen tasks. `media-drawer-text.store.ts` still uses a browser
    confirm for its discard prompt (`lint:dialogs` lists 14 `window.confirm` in admin, schedules, search, settings, media
    and the rich-text editor).
  - Undo of a deleted asset reads the asset's history at undo time (last live revision), not a revision remembered at
    delete time.
