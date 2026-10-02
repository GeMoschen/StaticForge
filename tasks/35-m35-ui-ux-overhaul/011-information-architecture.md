---
id: M35.11
status: done
depends: [M35.10]
epic: m35-ui-ux-overhaul
feature: frame
area: frontend
---

# M35.11 — Information architecture: Publishing area, Settings menu

## Context

`app.routes.ts` (settings children, legacy redirects), `features/settings/project-settings-shell.component.*`
(route-link tabs with `role=tab` and no `aria-selected`), `features/generation/*`. User decisions 8 and 9.

## Goals

- **Publishing** (`/p/:key/publishing`):
  - Sub-navigation: **Runs** (run list, run detail, *Build now* dialog), **Targets**, **Publish policy**.
  - The routes move out of `settings/generation`.
  - Old URLs redirect.
- **Settings** (`/p/:key/settings/...`):
  - A left side menu instead of tabs.
  - Sub-pages split from General: **General** (name, description, archive), **Languages**, **Channels**, **Media**,
    **Code highlighting**, **Compaction**.
  - Then Members and Import/export, in a grouped side menu (M35.9 decision 32): PROJECT (General, Languages,
    Channels, Media, Code highlighting), MAINTENANCE (Compaction, Import / export), PEOPLE (Members).
  - Quality, Redirects and the URL registry live in **Publishing** (M35.9 decision 30), not Settings.
  - Each sub-page has its own header and one save area.
- **Revisions** move out of Settings to `/p/:key/history` (the full page is built in M35.12). Old URLs redirect.
- Screens behind developer mode and permissions are hidden per M35.10.
- Every redirect is tested. Deep links from toasts (for example after release → "Build now") follow the new routes.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

## Acceptance criteria

- [x] Route table documented in the task's notes. Every old route redirects to its new home.
- [x] Vitest route tests for the redirects and guards.
- [x] `npx vitest run` and `npx ng build` green.

## Out of scope

- Restyling the screen contents (M35.24, M35.25).

## Notes (M35.9)

- The Publishing area and the Settings side menu use `sf-side-nav` (M35.9 decisions 28–29): a secondary side menu,
  not page tabs.
- Sample (decisions 28, 31, 32): Settings has General, Languages, Channels (developer mode only) and Import / export
  (steps) built; Media, Code highlighting, Compaction and Members are in the menu but were not built in the sample -
  design them from the same pattern (`sf-page-header`, one form, one save area). General has an archive **danger
  zone**.
- All Publishing sections (Runs, Targets, Policy, Quality, Redirects, URLs) are entries of the `sf-side-nav`.

## Notes (M35.10)

- The frame's rail item *Publishing* and the top-bar *History* button still point at Settings → Generation and
  Settings → Revisions. Repoint both here (and in M35.12), and keep the rail's active-item matching working for the new
  routes.

## Notes (M35.11 implementation)

Route table (below `/p/:projectKey`; `app.routes.ts`, tested by `app.routes.spec.ts` against the real table):

| New route | Screen | Notes |
|---|---|---|
| `publishing` → `runs` | `PublishingShellComponent` (`sf-side-nav`: Runs, Targets, Publish policy; group *Checks*: Quality, Redirects, URLs) | |
| `publishing/runs` | run list, run details, *Build now* | `?run=` and `?tab=findings` as before |
| `publishing/targets`, `policy`, `quality`, `redirects`, `urls` | the former Settings screens | |
| `history`, `history/:revisionId` | revisions list and diff | M35.12 builds the full page |
| `settings` → `general` | `SettingsShellComponent` (grouped side menu) | |
| `settings/general` | name, description | code highlighting moved out |
| `settings/languages`, `channels`, `media`, `code-highlighting`, `compaction`, `import-export`, `members` | one screen each | `channels`: `developerModeGuard('general')`; the menu hides Channels outside developer mode and Compaction from non-admins |

Old URLs (all redirect, query kept): `settings/generation` → `publishing/runs`; `settings/targets|quality|redirects`
→ `publishing/...`; `settings/url-registry` → `publishing/urls`; `settings/revisions[/:id]` → `history[/:id]`;
`settings/locales` → `settings/languages`. (`settings/media|channels` are real pages now.)

- Both areas share `AreaShellComponent` (`features/frame`): side menu, one `sf-page-header` (`h1` = the open page) and
  the page. Entries come from the pure `areaNav` (`core/frame/area-nav.ts`).
- Frame: `publishing` and `history` are project areas; the rail's *Publishing* and the top bar's *History* point at the
  new routes; every in-app link and toast target (build status, Build now, schedule history, redirects, rebuild
  reasons, revision links, spine tick) was repointed.
- `DeveloperModeService.enabledIn(projectKey)` answers for a guard (the frame's location lags the URL).
- Deviations / left for later: the **archive danger zone** of General (M35.9 decision 31) has no home yet in the
  project settings (archive/unarchive exist only in Administration and the archived banner); it is built with General's
  contents in M35.25. The sub-pages keep their own `h2` panel titles under the new `h1` until M35.24/M35.25 restyle
  their contents (out of scope here).
