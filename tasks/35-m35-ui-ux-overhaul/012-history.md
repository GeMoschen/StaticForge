---
id: M35.12
status: todo
depends: [M35.10]
epic: m35-ui-ux-overhaul
feature: frame
area: frontend
---

# M35.12 — History drawer, full history page, time-travel banner

## Context

The revision spine (`project-shell`, 44 px column of revision numbers), `sf-time-travel-banner`,
`features/revisions/*` (list, diff, restore), the time-travel state service, and asset history endpoints
(`/assets/{uuid}/versions`, `/restore`). User decision 9. M35.1 fixes the leaks first.

## Goals

- **Remove the spine**, together with its styles and breakpoints.
- **History drawer** (`sf-drawer`), opened from the top bar or `Ctrl+H` (subject to M35.14):
  - In an editor: that asset's versions. Each entry shows time, author name, a human summary and the languages
    touched. Actions: *View* (time travel to that version), *Compare with current* (diff), *Restore* (confirm, then
    undo toast).
  - Elsewhere: the project timeline (revisions with a human summary and the changed assets by name), filterable by
    author, type and date.
  - *Open full history* → `/p/:key/history`.
- **Full history page:** a timeline table (`sf-data-table`) with filters in the URL. The revision detail shows its
  changed assets with a diff. **Project roll-back** is a danger action with a typed confirmation.
- **Diff views:** human labels for sections (template display name plus position), localized values per language, no
  raw UUIDs.
- **Time travel:**
  - A persistent banner ("Viewing revision 70 · 12 Sep 14:03 · by Anna", *Back to now*, *Restore this state*).
  - Every screen is read-only with a distinct but calm frame accent.
  - Leaving the project ends time travel.

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

## Acceptance criteria

- [ ] No spine markup or styles left.
- [ ] Vitest: drawer per context (asset vs project), restore with undo, time-travel read-only and exit on project
      change.
- [ ] Screenshots reviewed. `npx vitest run` and `npx ng build` green.

## Notes (M35.9 / M35.10)

- The top bar's *History* button already exists (M35.10); this task gives it the drawer and the full page. The revision
  spine stays beside the screens until this task removes it.
- Open question from the gate (decide before building the drawer, together with M35.19): `sf-drawer` currently covers
  the dark top bar. Decide whether drawers start below it; History uses the same drawer.
