---
id: M30.3.1
status: todo
depends: [M30.2.1, M30.2.2, M30.2.3]
epic: m30-quality-checks-and-redirects
feature: editor-issues
area: backend
---

# M30.3.1 — Draft check endpoint

## Context

`PreviewController` (`GET /pages/{uuid}` `:69`–`:81`), `PageRenderService.renderPage(…, rewriteLinks)` (`:135`–`:170`),
`OutputPathResolver`, M27 `SnapshotView.DRAFT`, `PageService.contentIssues` (`PageView.issues`), `generate/quality/`
(`QualityRuleRegistry`, `QualityRuleConfigService`, `SectionMarkers`), `@AllowedOnArchivedProject` and
`ArchivedProjectEndpointWalkTest` (M26). Epic decision 13.

## Goals

- `POST /projects/{key}/preview/pages/{uuid}/checks?channel=&locale=&page=` (`VIEWER`; read-only; allowed on archived
  projects with `@AllowedOnArchivedProject("read-only check render")`, added to the walk test's allowlist with its
  reason). Response: `{completeness: ContentIssue[], findings: [{code, category, severity, message, selector,
  sectionInstanceId, editorPath?}], checkedChannel, checkedLocale, skippedRules: [code]}`.
- Render the **draft** of the page (M27 `SnapshotView.DRAFT`, drafts of dependencies included, like the default
  preview) with link rewriting **off** so hrefs are real output paths, and with **section markers**
  (`<!--sf:section {instanceId}-->…<!--/sf:section-->`) around every rendered section instance — markers are written by
  the renderer only when the render context asks for them (a flag on the render request), so preview and generation
  output stay byte-identical.
- Run the enabled **page rules** (project config) on the document, and the **link rules** against an index of the
  draft's planned output paths (every draft page/media path in every channel and locale, computed with
  `OutputPathResolver` over the draft snapshot — no rendering of other pages). Skipped and listed in `skippedRules`:
  cross-page anchors (`0107` except same-page), duplicates (`0205`, `0206`), `0103`, `0109`, `0210`.
- Map findings to an editor location: `sectionInstanceId` from the markers; for `0301`/`0302` on an `img` whose `src`
  resolves to a media asset referenced by a `media` editor, `editorPath` = that editor's full path (from the page's
  content; best effort, `null` otherwise).
- Rate-limited like preview render (§26.3 "preview render" limiter) — reuse it.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] Integration test: a draft with a missing alt in section 2 and a link to a missing page returns both findings with
      section 2's instance id; the same page's preview HTML contains no `sf:section` comment.
- [ ] Unreleased-but-drafted target page: no `0104` in draft checks (drafts are the view), but `0104` in a build (test
      both, documents the difference).
- [ ] Non-HTML channel → `findings: []`, all rules in `skippedRules`, completeness still returned.
- [ ] `VIEWER` allowed, non-member `404`, archived project allowed (walk test allowlist updated).
- [ ] `./gradlew build` green.

## Out of scope

- The UI (`M30.3.2`); checking unsaved keystrokes (the preview model renders the last autosave, §19.2).

## Notes / hazards

- Markers must survive the page template's layout (`$CMS_EXTENDS$`/blocks) and never land inside an attribute or a
  `<script>`/`<style>` — emit them only around section renders in body context; if a section template renders
  inside such a context, skip its marker (test with a section rendered inside `<head>`).
- Cost: one render + one parse per call; the UI calls it after autosave (debounced), not per keystroke.
