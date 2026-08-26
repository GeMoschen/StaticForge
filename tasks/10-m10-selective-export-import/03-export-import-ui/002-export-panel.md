---
id: M10.3.2
status: todo
depends: [M10.3.1]
epic: m10-selective-export-import
feature: export-import-ui
area: frontend
---

# M10.3.2 — Export panel component

## Context

Half of the new settings tab: letting the user build an `ExportSelection` visually and
download the resulting ZIP.

## Goals

- `project-settings-export.component.ts` (standalone, `OnPush`, following the
  `project-settings-url-registry.component` structure: signals for state, a service
  injected via `inject()`, template/style files split out).
- Tree view of the project's folders/assets with tri-state checkboxes (a folder shows
  indeterminate when only some descendants are picked; picking a folder picks its full
  subtree, matching the backend's expansion semantics from `M10.1.1` so the UI's
  "what's selected" story matches what actually gets exported).
- Two standalone toggles: "Include output channels", "Include generation targets",
  visually separated from the asset tree (they're not part of it).
- An Export button, disabled when nothing is selected and both toggles are off (mirror
  the backend's empty-selection rejection so the user sees a disabled button rather
  than a server error).
- On click: build the request, call `exportSelection`, trigger a browser download of
  the returned blob with a sensible filename (`{projectKey}-export.zip` or similar) —
  no server round-trip needed for naming, mirror how the ZIP generation-target writer
  or existing export flow names its files if a convention already exists.
- Loading state on the button while the request is in flight; error state (toast/inline
  message) on failure.

## Acceptance criteria

- [ ] Selecting a folder auto-selects its full current subtree in the UI (visually,
      before the request is even built) — verified by a component test.
- [ ] Export button is disabled with nothing selected and both toggles off; enabled
      the moment either becomes true.
- [ ] A successful export triggers a file download (test via a spy on whatever download
      mechanism is used — anchor click, `URL.createObjectURL`, etc.).
- [ ] A failed export (service error) shows an inline error, not a silent no-op.

## Out of scope

- Import panel (`M10.3.3`).
- Tab wiring/routing (`M10.3.4`).

## Notes / hazards

- A large project's asset tree could be sizeable — check whether the reused
  tree-fetch endpoint (from `M10.3.1`) paginates or lazy-loads by folder; if it does,
  the tree component needs to expand-on-demand rather than assuming the whole tree
  fits in memory client-side.
