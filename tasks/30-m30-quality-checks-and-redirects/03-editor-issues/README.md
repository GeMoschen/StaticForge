# Feature: Editor issues — checks on the draft, Issues panel in the page editor

**Spec:** Extends §10.5 (advisory `issues`), §19 (preview — draft check render), §23.6 / §24 (page editor layout).

## Goal

Editors see problems while they write, not after a build: the page editor shows the page's completeness findings
(computed on every response today, never shown) and the quality checks run on the draft render, and jumps to the
field or section that causes them.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-draft-check-endpoint.md](001-draft-check-endpoint.md) | `M30.2.1`, `M30.2.2`, `M30.2.3` |
| 2 | [002-page-editor-issues-panel.md](002-page-editor-issues-panel.md) | 1 |

## Feature exit criteria

- [x] `POST …/preview/pages/{uuid}/checks` returns page-local and link findings for the draft plus completeness issues.
- [x] The page editor's Issues panel lists both, refreshes after autosave, and jumps to the field or section.
- [x] `./gradlew build`, `ui` `npm run build` and `npx vitest run` green.

## Dependencies

`M30.2.*` (rules), `M27` (`SnapshotView.DRAFT`), `PageRenderService`, `PreviewController`, `sf-content-form`
(`issues` input), `features/pages/page-editor.component.*`.
