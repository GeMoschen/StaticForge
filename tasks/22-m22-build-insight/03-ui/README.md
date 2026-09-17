# Feature: Build insight UI

**Spec:** Extends §24.5 (core screens — generation) and §24.6 (interaction rules:
errors carry the fix, explain rather than hide).

## Goal

Put the explanations where decisions are made:

1. **Before a run:** the generation dialog (`generation-dialog.component`) gains a plan
   preview backed by the dry run. It shows how many files will rebuild and why, grouped
   by reason, with expandable chains and a clear warning when an incremental request
   falls back to a full build.
2. **After a run:** the run details row in `generation.component` gains a "Rebuilt
   pages" tab backed by the stored plan.
3. **While editing:** a shared "Impact" panel shows what a change to the current asset
   would rebuild. It appears in the template editor, the media detail drawer (next to
   the existing usages list) and the page editor.

One shared chain-rendering component is used by all three, so a reason reads the same
everywhere, e.g.
`about.html ← page_template:article ← (include) section_template:teaser ← media:hero · changed r1842`.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-dry-run-preview-dialog.md](001-dry-run-preview-dialog.md) | `M22.2.1` |
| 2 | [002-run-rebuilt-pages-and-impact-panel.md](002-run-rebuilt-pages-and-impact-panel.md) | `M22.2.1`, `M22.2.2`, 1 (reuses its chain component) |

## Feature exit criteria

- [x] Dialog preview, run "Rebuilt pages" tab and Impact panel exist and share one
      reason/chain component.
- [x] All three are keyboard-complete and meet the WCAG 2.2 AA baseline (§24.7):
      chains are readable as text, not only as icons or colors.
- [x] Time travel: the dialog stays disabled as today; stored plans and impact remain
      viewable read-only, and impact is labelled "as of now".

## Dependencies

`M22.2.*`, `M4`/`M6` generation UI (`ui/src/app/features/generation/`:
`generation.component`, `generation-dialog.component`, `generation.service.ts`,
`generation-diagnostics.ts`), media drawer, template editor
(`features/templates/templates.component`), page editor
(`features/pages/page-editor.component`), `TimeTravelStore` / read-only interceptor
(`M15.5`).
