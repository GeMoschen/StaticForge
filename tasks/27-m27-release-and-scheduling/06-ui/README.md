# Feature: UI — release status, release bar, Changes view, preview toggle, localized media, Schedules

**Spec:** Extends §23 (features `changes/`, `schedules/`), §24.5 (core screens), §24.6 (interaction rules), §24.7
(accessibility), §19.3 (preview affordances).

## Goal

Editors and developers see at a glance what is published, changed or new — per locale — release, unpublish, discard
and schedule from each editor and from one central Changes view, switch the preview between draft and published,
manage localized media files, and manage schedules.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-release-status-and-release-bar.md](001-release-status-and-release-bar.md) | `M27.1.3` |
| 2 | [002-changes-view.md](002-changes-view.md) | 1, 5, `M27.4.4` |
| 3 | [003-preview-view-toggle-and-share.md](003-preview-view-toggle-and-share.md) | `M27.2.3` |
| 4 | [004-localized-media-ui.md](004-localized-media-ui.md) | `M27.3.1`, 1 |
| 5 | [005-schedules-ui.md](005-schedules-ui.md) | `M27.4.4`, 1 |

Order: 1 → 5 → 2 (the Changes view uses the schedule dialog from 5). Tasks 3 and 4 can run in parallel with the
others (different feature folders).

## Feature exit criteria

- [ ] Status badges (per locale) in the page tree/list, content store, globals, media library and navigation.
- [ ] Release bar with Release / Unpublish / Discard / Schedule in every releasable editor; dependency dialog.
- [ ] Changes view with filters, diff and multi-select release/discard/schedule; nav-rail badge.
- [ ] Preview Draft/Published toggle; share dialog chooses the view.
- [ ] Localized media: toggle, per-locale files, discard confirmation.
- [ ] Schedules page: list, create/edit (cron presets + cron text, viewer time zone), cancel, take over, run now,
      re-pin, history.
- [ ] Every action hidden/disabled by role (`DEVELOPER` in M27) and read-only mode (time travel, archived).
- [ ] `npm run build` and `npx vitest run` green.

## Dependencies

`M27.1.3`, `M27.2.3`, `M27.3.1`, `M27.4.4` (API + regenerated `schema.d.ts`); `features/pages`, `features/content`,
`features/globals`, `features/media`, `features/navigation`, `features/preview`, `features/dashboard`
(`nav-rail.component`), `features/revisions` (`revision-diff.component` — reuse for the draft/released diff),
`core/project` (`project-access.store`, `editing-locale.store`, `locales.store`), `core/auth` (`AuthStore.roleFor`).
