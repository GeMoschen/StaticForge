---
id: M18.4.1
status: done
depends: [M18.1.2, M18.2.1, M18.3.2]
epic: m18-parsable-text-media
feature: ui
area: frontend
---

# M18.4.1 — Media drawer: process toggle, source editor, rendered view

## Context

`ui/src/app/features/media/media-detail-drawer.component.ts` shows a media preview (loaded
through HttpClient as an object URL), the metadata form (alt text, caption, copyright, focal
point), usages, and `replaceMedia`. The app has **no code editor component**: the template
IDE (`features/templates/templates.component.html`) uses plain `<textarea>`s for CDL and OCTL
source and lists CDL diagnostics under them. `M15.5` made every editor surface read-only
while `TimeTravelStore.isTimeTravel` is true, with an HTTP interceptor backstop.

## Goals

- **Toggle.** "Process CMS syntax" switch, shown when `media.textEditable`, bound to the
  `M18.1.1` flag endpoint:
  - Switching on shows the save response's warnings inline (e.g. "`$$` on line 12 will be
    output as `$`") and keeps the toggle on.
  - A 422 turns the toggle back off and lists the errors.
  - Short help text explains that `$$` becomes `$` when processing is on.
- **Source tab** (text media only):
  - Loads `GET …/text` into a monospace `<textarea>`, following the templates IDE pattern.
    Tab key inserts a tab, and line endings are preserved as received.
  - Debounced live validation (`POST …/text/validate`) runs only when `processCms` is on.
    Diagnostics list with line:col. Clicking a diagnostic moves the caret to that position.
  - Save sends `PUT …/text` with `If-Match` and is disabled while errors are present.
  - A 409 opens the existing conflict drawer flow rather than a custom dialog.
  - Unsaved-changes guard when closing the drawer or switching media.
  - A banner appears when the backend reports the file isn't clean UTF-8.
- **Rendered tab** (processed files only): read-only view of `GET …/binary?rendered=true`,
  refreshed on open and after save. A 422 shows the diagnostics instead.
- **Time travel:** toggle, textarea and Save are disabled, following the `M15.5` pattern.
  Source reads use the viewed revision.
- A small "CMS" badge on processed items in `media-library.component`, so processed files
  are recognizable in the grid/list.

## Acceptance criteria

- [x] For a CSS file, the toggle and Source tab are visible. For a PNG, neither is.
- [x] Switching on a file with `$$` shows the warning. Switching on a file with an unknown
      `global:` reference shows the error and the toggle ends up off.
- [x] Editing and saving creates a revision: the revision spine updates, and the drawer's
      `If-Match` token advances.
- [x] Live validation shows an error while typing `$CMS_BODY(x)$` and Save is disabled.
      Clicking the diagnostic moves the caret.
- [x] Rendered tab shows substituted global values after saving a global and reopening the tab.
  - *Verified 2026-09-16:* live, the tab showed the substituted global after a source save; it re-renders on every
    open, and rendering with a changed global value is covered by `ProcessedMediaPreviewIntegrationTest`.
- [x] Time travel: all controls disabled. The Source shows the historical content.
- [x] Unsaved-changes guard triggers on drawer close.
- [x] Spec tests for the new component logic. Pure logic (diagnostic→caret offset, dirty
      state) goes in non-`templateUrl` specs so it actually runs; see the memory note on the
      broken `templateUrl` spec runner. `npm run build` is green.
- [x] Verified in the running app (dev backend + `ng serve`), not only via specs.

## Out of scope

- Syntax highlighting, autocomplete, or adding Monaco/CodeMirror. `M20.4.1` owns the template
  IDE upgrade; if it introduces a shared code editor component, adopting it here is a
  follow-up.
- Creating new text files from scratch in the UI.

## Notes / hazards

- `<textarea>` with very large files (minified bundles of several MB) becomes sluggish. Past a
  size threshold (e.g. 1 MB), show a read-only notice instead of the editor, and point the
  user at replace/upload.
- The Rendered tab must render as **text**, never inject it as HTML or load it as an `<img>`.
  Rendered SVG shown as an image goes through the existing object-URL preview, which is
  sanitized server-side.

## Implementation notes (2026-09-16)

- Drawer tabs **Details / Source / Rendered** (Source and the toggle only for `textEditable`, Rendered only while
  processed); the drawer widens on Source/Rendered. `ApiClient` gained `setMediaProcessCms`, `mediaText`,
  `saveMediaText`, `validateMediaText`, `mediaRenderedText`; `replaceMedia` returns `MediaSaveResponse`.
- Source: the textarea is seeded only on load (typing never resets the caret), Tab inserts a tab, CRLF is restored
  on save, debounced validation (400 ms, stale answers dropped) while processing is on, Save disabled on errors, a
  click on a diagnostic moves the caret, 409 opens `sf-conflict-drawer` in its summary mode (new `subject` input:
  "This file changed…"; keep mine = save over the newer revision, take theirs = reload), files over 1 MB are
  read-only with a notice, a non-UTF-8 banner. Unsaved-changes guard on close, on replace and when the library
  switches files (`confirmDiscard`, the library's own `window.confirm` convention).
- Rendered is shown as text in a `<pre>`, never as HTML.
- Time travel: toggle, editor and Save disabled; Source and Rendered read `?revision=`.
- Library: a **CMS** badge on processed items (grid) and in the drawer title. The media route is now lazy-loaded:
  the drawer growth pushed the initial bundle past its 900 kB error budget (922.8 kB); lazy media brings it to
  841 kB.
- The UID-rename warning now says "templates or processed media files".
- Specs: `text-media.util.spec.ts` (10, runs: caret offsets incl. CRLF, tab insert, diagnostics, line endings). The
  drawer's own `templateUrl` spec still can't run (known runner issue); `ng build` type-checks it.
- **Verified in the running app** (dev backend + `ng serve`) by `ui/e2e/m18-journeys.spec.ts`, see `M18.5.1`.
