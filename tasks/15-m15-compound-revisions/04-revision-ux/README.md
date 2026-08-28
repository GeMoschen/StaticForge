# Feature: Revision UX for multi-asset revisions

**Spec:** §24.2 (revision spine — its own illustrative mock, "1840 Elena · Uploaded 3
files · 11:31," already depicts one revision covering 3 files, even though the backend
has only ever produced single-asset revisions until this milestone), §7.5/§7.6
(conflict/restore), §5.4 (usages).

## Goal

`RevisionDiff` and `RevisionView.summary` are already list-shaped, and the M6-era UI
(`revision-diff.component.ts`, `sf-visual-diff`/`sf-body-diff`/`sf-field-diff`) already
*renders* a revision's `assets: AssetDiff[]` as a list — so the diff view needs
comparatively little rework. What's missing is everywhere the UI currently assumes,
implicitly, that a revision's label is "one change": the revision spine's tick
hover/pulse label and the history list's row subtitle both currently call a
`summaryFor(rev)` that returns only `rev.comment ?? rev.changeType` — accurate for a
revision touching one asset, misleading for one touching eight (a bare `"CREATE"` tick
for what was, before `M15.2.1`, the entire project bootstrap). This feature makes
every revision-related surface honestly represent `summary.assets.length`, and confirms
restore, conflict, and usages semantics stay correct and clear once a revision can list
many assets.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-spine-and-history-asset-count.md](001-spine-and-history-asset-count.md) | `M15.2` (needs a real multi-asset revision to develop against) |
| 2 | [002-diff-restore-conflict-multi-asset.md](002-diff-restore-conflict-multi-asset.md) | 1 |

## Feature exit criteria

- [ ] `revision-spine.component`'s tick hover label and `revisions-list.component`'s
      row subtitle both show an asset-count affordance (e.g. "8 assets" or a listing of
      the first few + "and N more") whenever `summary.assets.length > 1`, falling back
      to today's single-line label when it's exactly 1 (the common case, unchanged).
- [ ] `revision-diff.component`'s per-asset diff list remains correct and legible for
      N>1 assets (verified against a real project-creation revision, not a synthetic
      fixture) — per-asset restore (`restoreAsset`) still targets exactly the clicked
      asset among many, and project-wide rollback's confirmation copy still accurately
      describes what it does regardless of how many assets the target revision touched.
- [ ] The conflict drawer (`conflict-drawer.component`, scoped to one asset/uuid per
      `PageAutosaveService`'s single-asset autosave flow) is confirmed to need **no**
      change — a 409 conflict is still always about one specific asset's concurrent
      write, never about a whole batch, since this milestone doesn't add a batched
      *write* UX (see the epic README's note on scope).
- [ ] `ui` `npm run build` and `npm test` green.

## Dependencies

`M6:revision-spine`, `M6:history`, `M6:conflict` (the components this feature updates),
`M15.2` (produces the real multi-asset revisions this feature is built and tested
against — project creation is the primary development fixture).
