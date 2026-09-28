# Feature: UI — Quality and Redirects settings, run findings, redirect on unpublish

**Spec:** Extends §24.5 (settings screens, generation run details), §24 editor UX (unpublish/delete dialogs).

## Goal

Make the checks and redirects usable without the API: configure rules, read a run's findings and jump to the page,
manage redirects, choose redirect formats per target, and redirect a page's old URL when unpublishing or deleting it.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-quality-rules-tab.md](001-quality-rules-tab.md) | `M30.1.2`, `M30.2.*` |
| 2 | [002-run-findings-report.md](002-run-findings-report.md) | `M30.1.3` |
| 3 | [003-redirects-tab-target-formats-and-unpublish-redirect.md](003-redirects-tab-target-formats-and-unpublish-redirect.md) | `M30.4.1`, `M30.5.1` |

Tasks 1–3 touch different components and can run in parallel; 1 and 3 both add a settings tab — agree on the tab order
(General · Members · Generation · Quality · Redirects · Revisions · Navigation URLs · Import / Export).

## Feature exit criteria

- [x] Quality tab (editable for developers), Redirects tab (editable for developers), findings in run details,
      redirect formats in the target form, "Redirect old URL to…" in unpublish/delete dialogs.
- [x] `npm run build` and `npx vitest run` green.

## Dependencies

`M30.1.*`, `M30.2.*`, `M30.4.1`, `M30.5.1` (API + regenerated `schema.d.ts`); `features/settings`
(`project-settings-shell`, `project-settings-targets.component`, `project-settings-url-registry.component` as the
list/paging model), `features/generation` (`generation.component`, `generation-diagnostics.ts`, `insight/`),
M27 unpublish/delete dialogs, `AuthStore.roleFor`, `ProjectAccessStore.readOnly`, M28 effective permissions.
