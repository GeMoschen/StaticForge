---
id: M35.28
status: todo
depends: [M35.15, M35.16]
epic: m35-ui-ux-overhaul
feature: extras
area: fullstack
---

# M35.28 — Dashboard 2.0 and project home

## Context

`features/dashboard/dashboard.component.*` (project cards with truncated names, raw role enums, search only above 12
projects, an inline create form with the key first). Screenshots 02–04. User decision 21. Spec §24.5 asks for the last
revision and the last activity.

## Goals

- **Project list** (`/`):
  - Favorites first, then the rest.
  - Card or table toggle.
  - Each card shows name (never truncated before other text), description, role as a human label, last activity
    (relative), unreleased change count, and last build status.
  - Search is always present.
  - *New project* opens a dialog: Name first, key derived and editable, description.
- **Project home** (`/p/:key`, rail item *Home*) — widgets, each with an empty state and permission-aware visibility:
  - Recent and favorites (M35.15)
  - My unreleased changes
  - Last build (status, *Build now*)
  - Upcoming schedules
  - Quality findings summary
  - Quick actions (New page, Upload media, Open Changes)
- **Backend:** one aggregate endpoint per view, so the dashboard doesn't fan out N calls:
  - project list with activity and counts
  - project home summary

  Each has an integration test and a query-count test.

## Acceptance criteria

- [ ] Screen definition of done met (README).
- [ ] Backend tests green, OpenAPI regenerated, `docs/api.md` updated.
- [ ] `./gradlew test`, `npx vitest run` and `npx ng build` green.
