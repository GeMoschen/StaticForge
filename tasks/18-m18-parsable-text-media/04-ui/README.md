# Feature: UI — process toggle and text editor

**Spec:** Extends §23 (Angular media feature) and §24.5/§24.6 (core screens, "errors carry the
fix" interaction rule) for the media detail drawer.

## Goal

In `ui/src/app/features/media/media-detail-drawer.component.ts`, a text media file gets:

- a **"Process CMS syntax"** toggle, visible only when the media view reports `textEditable`
- a **Source** editor: the file's text with live diagnostics and Save, where each Save
  creates a revision
- a **Rendered** tab for processed files, showing the output at the current revision

Everything stays read-only while time travel is active, as every other editor surface does
since `M15.5`.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-media-drawer-toggle-and-text-editor.md](001-media-drawer-toggle-and-text-editor.md) | `M18.1.2`, `M18.2.1`, `M18.3.2` |

## Feature exit criteria

- [ ] Toggle, Source editor and Rendered tab work end to end against the real backend.
- [ ] Diagnostics from save and from live validation are shown with line/column, and errors
      block Save.
- [ ] Time travel disables toggle and Save. 409 conflicts use the existing conflict UX.

## Dependencies

`M18.1.2` (text endpoints), `M18.2.1` (validation endpoint + diagnostics in save responses),
`M18.3.2` (`?rendered=true`). `M15.5` time-travel gating. Regenerated `schema.d.ts`.
