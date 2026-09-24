---
id: M26.4.3
status: todo
depends: [M26.1.2]
epic: m26-user-management
feature: ui
area: frontend
---

# M26.4.3 — Project settings: Members tab

## Context

`features/settings/project-settings-shell.component` (tabs General · Generation · Revisions · Navigation URLs ·
Import / Export), `/projects/{key}/members` (+ `status`, emails only for project admins), `GET /users/lookup`.
Epic decisions 1, 6, 13.

## Goals

- New tab **Members** (after General), route `settings/members`, visible to every project member.
- Table: display name + username, role, granted at, granted by, status (disabled members greyed with a "Disabled"
  chip), email column only when the API returns emails. A note: "Instance administrators have access to every
  project and are not listed."
- `PROJECT_ADMIN` (and instance admins): "Add member" — typeahead over `GET /users/lookup` (existing members shown but
  not selectable) + role select; role dropdown per row; remove with confirmation (removing yourself warns that you
  lose access and navigates to the dashboard afterwards).
- Below `PROJECT_ADMIN` the tab is read-only (no add, no role select, no remove).
- Revision spine/history already records membership changes; after a change, refresh the member list only.

## Acceptance criteria

- [ ] Vitest specs: read-only vs editable per role, typeahead (debounce, member rows disabled), add/change/remove
      calls, self-removal warning and navigation, email column presence follows the payload.
- [ ] Manual check in the running app as a project admin and as an editor.
- [ ] `npm run build` green.

## Out of scope

- Creating users (instance admin only, `M26.4.2`).

## Notes / hazards

- Removing or changing your own membership invalidates your token (epoch bump): the refresh interceptor gets a `401`,
  refreshes, and the new claim lacks the project → the next project call is `404`. Navigate away before that
  surfaces as an error toast.
