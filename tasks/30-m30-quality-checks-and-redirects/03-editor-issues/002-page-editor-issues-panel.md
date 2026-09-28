---
id: M30.3.2
status: done
depends: [M30.3.1]
epic: m30-quality-checks-and-redirects
feature: editor-issues
area: frontend
---

# M30.3.2 — Page editor: Issues panel

## Context

`features/pages/page-editor.component.{ts,html}` (`sf-content-form` at html `:157` without `[issues]`; the impact panel
`<sf-asset-impact>` at `:166`–`:167`; preview `SfPreviewFrameComponent`), `features/forms/sf-content-form.component.ts`
(`issues` input `:53`, bound only by `features/content/record-editor.component.html:64`), `features/preview/preview.frame.component.ts`
(section highlight by instance id, `:42`–`:79`), `autosave.service.ts`, M27 locale switcher / draft-published preview
toggle. Epic decision 13.

## Goals

- Bind `PageView.issues` to `sf-content-form` so completeness findings show on their fields (like the record editor).
- An **Issues** panel (next to the impact panel, collapsible, count badge in its header): two groups — *Content*
  (completeness findings: path, message, severity) and *Output* (draft check findings: rule name, severity, message,
  "fix in content" / "fix in template" hint from the rule description).
- Calls `POST …/preview/pages/{uuid}/checks` for the editor's current channel and locale after each completed autosave
  (debounced like the preview, 400 ms) and on locale/channel switch; shows "checked at hh:mm" and a spinner; errors
  degrade to "Checks unavailable" without blocking editing.
- Clicking a finding: with `editorPath` → focus that field; with `sectionInstanceId` → focus the section's form and
  highlight it in the preview (reuse the preview frame's instance highlight); otherwise highlight the element in the
  preview by `selector` if the frame can reach it, else just expand the message.
- While the preview shows the **Published** view (M27 toggle) the panel says the checks cover the draft.
- Read-only states (time travel, archived, viewer) still show issues.

## Acceptance criteria

- [x] Vitest specs with fixtures shaped like the generated `schema.d.ts` response (lessons 2026-09-23): grouping,
      counts, debounce after autosave, locale switch re-check, jump targets (field, section, none), error state.
- [x] Manual check in the running app: missing alt in a section → click jumps to that section in form and preview.
- [x] No layout overflow at 1280 px with the panel open (lessons 2026-09-16 — assert in the journey).
- [x] `npm run build` and `npx vitest run` green.

## Out of scope

- Issues in the record, global-set or media editors (records already show completeness).

## Notes / hazards

- Don't let the check call race the preview: both refetch after autosave; cancel an in-flight check when a newer
  autosave completes (switchMap).

- Done: `PageIssuesPanelComponent` (`features/pages/page-issues-panel.component.*`, `DraftChecksService`,
  `page-issues.util.ts`) below the centre column in every scope (page, body, section) — in page scope right under the
  impact panel — so an issue can be followed from anywhere. `PageView.issues` (load, every save, section changes, and the
  check's `completeness`) is bound to the page form and to every section card's form (`issuePrefix`
  `bodies.<body>[<i>].content`). The check is debounced 400 ms after each completed autosave, on a language switch and
  on time travel (`?revision=`); `switchMap` cancels an overtaken check.
- Jump: `issueDestination` decides — a page field opens the page scope and focuses the field; a section field
  (`bodies.main[1].content.image`, resolved to the section by body and index) or a section instance opens
  `?section=` and focuses the field or the card; the preview outlines the section by `data-sf-instance`, else the
  finding's element by its selector (the highlight script accepts `selector` and scrolls it into view). Only while the
  preview shows Draft; in Published the panel notes that the checks cover the draft.
- Manual check (2026-09-27, scripted with Playwright against bootRun 8091 + ng serve 4311): a page with a Figure section
  whose image has no alt — the panel lists "Image without alt attribute · Fix in content or template"; clicking it opens
  `?section=figure-2`, outlines and focuses the Image field and outlines the `<img>` in the preview. At 1280 px with the
  panel open: document scrollWidth 1280 = clientWidth, centre column scrollWidth = clientWidth, panel and preview inside
  the viewport (also in section scope). The journey assertion comes with M30.7.
