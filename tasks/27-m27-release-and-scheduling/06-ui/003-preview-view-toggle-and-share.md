---
id: M27.6.3
status: done
depends: [M27.2.3]
epic: m27-release-and-scheduling
feature: ui
area: frontend
---

# M27.6.3 — Preview: Draft/Published toggle and share-link view

## Context

`features/preview/preview.frame.component.*` (srcdoc sandbox, viewport switcher, pagination, locale), the share-link
dialog/button in the page editor, `preview-error.ts`, API `?view=`, `X-SF-View`, `X-SF-Release-Status`, `404
SF-DOM-0155`, share `view` parameter (`M27.2.3`). Epic decision 16.

## Goals

- **Toggle** "Draft | Published" in the preview toolbar (segmented control, keyboard accessible), default Draft,
  persisted per user like the split ratio. Published mode fetches `view=published`.
- **Not published**: the frame shows an empty state "Not published in {locale}" (from `SF-DOM-0155`) with a hint to
  release, instead of an error.
- A small status line under the toolbar in Draft mode: "Draft — {status}" from `X-SF-Release-Status`.
- Links clicked inside the frame keep the mode (the server rewrites links with `view`; verify the component doesn't
  drop it on navigation).
- **Share dialog**: choice "Draft (latest saved)" / "Published", default = the current toggle; the generated link says
  which in its label.

## Acceptance criteria

- [x] Vitest: toggle sends `view`; `SF-DOM-0155` renders the empty state; share request carries the view.
- [x] Manual check: edit a published page → Draft shows the edit, Published shows the old text; per locale.
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Visual diff between draft and published (the revisions visual-diff could do it later).

## Notes / hazards

- The preview refetch after autosave (§19.2) only matters in Draft mode; don't refetch the published view on each
  autosave.
