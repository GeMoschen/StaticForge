---
id: M35.11
status: todo
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
  - Then Members, Quality, Redirects, URL registry, Import/export.
  - Each sub-page has its own header and one save area.
- **Revisions** move out of Settings to `/p/:key/history` (the full page is built in M35.12). Old URLs redirect.
- Screens behind developer mode and permissions are hidden per M35.10.
- Every redirect is tested. Deep links from toasts (for example after release → "Build now") follow the new routes.

## Acceptance criteria

- [ ] Route table documented in the task's notes. Every old route redirects to its new home.
- [ ] Vitest route tests for the redirects and guards.
- [ ] `npx vitest run` and `npx ng build` green.

## Out of scope

- Restyling the screen contents (M35.24, M35.25).
