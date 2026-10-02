---
id: M35.13
status: todo
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

## Acceptance criteria

- [ ] Vitest: guard on route change and in-screen switch, `beforeunload` registration, `Ctrl+S` routing, undo for
      delete/move/rename (mocked API), and a failed undo shows an error toast.
- [ ] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- A reload after a save must not take back newer edits (`tasks/lessons.md`, 2026-09-30).
- Restoring a deleted asset may fail if its folder was deleted too. Undo the group in reverse order.

## Notes (M35.9)

- The sample shows the intended look: `sf-page-header` with the save status beside the actions, destructive actions in
  the ⋮ menu with a typed confirmation for large ones, and undo through `sf-toast`. Reuse these; don't add new
  patterns.
- Release actions are a group of their own in the header (decision 34); `sf-save-status` sits before that group.
