---
id: M12.2.2
status: todo
depends: [M12.2.1]
epic: m12-asset-metadata-and-creation-ux
feature: create-asset-dialog
area: frontend
---

# M12.2.2 — Replace every ad hoc creation flow with the shared dialog

## Context

Five call sites need to switch to `M12.2.1`'s new `sf-create-asset-dialog`:

- `pages-list.component.ts`: `createFolderUnder`'s `window.prompt('Folder
  name')`, and its own one-off `openNewPage`/`newPageForm` panel (both
  folder and page creation move to the shared dialog — the existing panel is
  removed, not kept alongside the new one).
- `media-library.component.ts`: `createFolderUnder`'s
  `window.prompt('Folder name')` (line ~302) — note there's a **second**
  `window.prompt` at line ~416 used for *renaming* an existing folder, which
  is `M12.1`'s territory (metadata editing), not this task; don't conflate
  the two while grepping for prompts to replace.
- `navigation.component.ts`: the folder-creation `window.prompt('Folder
  name')` and the reference-creation `window.prompt('Reference name')`.
- `templates.component.ts`: `newTemplate()`'s immediate hardcoded-placeholder
  creation — replaced with opening the dialog first, then creating with the
  name the user actually typed.

## Goals

- Wire each of the five call sites above to open `sf-create-asset-dialog`
  with the right "kind" input, and perform that screen's own existing create
  API call (`ApiClient.createFolder`, `ApiClient.createPage`,
  `TemplatesService.create`, `NavigationService`'s create methods) from the
  `created`/submit output — per `M12.2.1`'s "dialog collects input, caller
  creates" design, no screen's API-calling logic should move into the shared
  component.
- Remove every `window.prompt(...)` used for *creation* specifically (not
  the rename ones scoped to `M12.1`/existing behavior, which stay untouched
  unless a specific `M12.1` task says otherwise).
- Preserve each screen's existing success/error handling (toasts, list
  reload, selecting the newly created item) — this task changes how the
  input is collected, not what happens after a successful create.

## Acceptance criteria

- [ ] All three folder-creation flows (Pages, Media, Navigation) use the
      shared dialog with a `FOLDER` kind, scoped correctly (`PAGES`/`MEDIA`/
      `NAVIGATION`).
- [ ] Page creation uses the shared dialog; `pages-list.component`'s old
      inline new-page panel and `newPageForm` are removed.
- [ ] Template creation opens the dialog first and creates with the
      user-provided name — no more hardcoded "New page template"/"New
      section template" placeholder text reaching the backend.
- [ ] Navigation reference creation uses the shared dialog.
- [ ] `grep -rn "window.prompt" ui/src/app/features` finds zero remaining
      creation-related calls (rename-related ones from `M12.1`'s scope may
      still exist unless separately addressed).

## Out of scope

- Any change to what happens *after* a successful create (reload/selection/
  toast wording) beyond what's needed to keep it working with the new input
  path.

## Notes / hazards

- `pages-list.component`'s new-page panel removal is the riskiest single
  change here (an existing, working, tested flow) — verify its existing
  component spec (if any) is updated to match rather than left asserting
  against removed internals.
