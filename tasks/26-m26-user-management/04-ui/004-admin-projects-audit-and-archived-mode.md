---
id: M26.4.4
status: done
depends: [M26.2.1, M26.3.1, M26.4.2]
epic: m26-user-management
feature: ui
area: frontend
---

# M26.4.4 — Admin projects, instance audit, archived read-only mode

## Context

`features/admin` shell (`M26.4.2`), `GET /admin/projects`, `POST /projects/{key}/archive|unarchive`,
`GET /admin/audit(/actions)`. Project UI: `ProjectContextStore.project()` (`archived`), per-component edit gating via
`AuthStore.roleFor(projectKey)` + `roleRank`, dashboard project list. Epic decisions 12, 14.

## Goals

- **Projects tab** `/admin/projects`: table (key, name, member count, last change, archived chip), search,
  "Show archived" (default on), actions Open, Archive (confirmation: members lose access, project becomes
  read-only), Unarchive. "New project" stays on the dashboard.
- **Audit tab** `/admin/audit`: server-paged table (time, action, actor, project, target, detail expandable),
  filters: action multi-select (from `/admin/audit/actions`), user (lookup by username), project (incl.
  "Instance only"), date range; filters kept in the URL query.
- **Archived mode in a project:** a banner in the project shell ("This project is archived and read-only." + Unarchive
  button for instance admins). The effective role in an archived project is `VIEWER`: implement it once where the UI
  resolves the role (`AuthStore.roleFor` or a project-aware wrapper), so every role-gated control turns read-only
  without per-component changes. Controls gated only on time travel or not at all must be found and fixed (the
  backend answers `409 SF-DOM-0141` anyway — surface that message if it slips through).
- **Dashboard:** instance admins see archived projects with an "Archived" chip; members never see them (the API
  omits them).

## Acceptance criteria

- [x] Vitest specs: projects table actions and confirmations, audit filter → query params round trip, effective-role
      downgrade for archived projects (a representative editor, e.g. page editor + record editor become read-only),
      banner visibility per role.
- [x] Manual check in the running app: archive a project as admin → banner, no edit control enabled in pages,
      content, templates, settings, generation; as a member the project is gone; unarchive restores it.
- [x] `npm run build` green.

## Out of scope

- Archive semantics beyond decision 12 (e.g. deleting projects).

## Notes / hazards

- Walk every feature's primary edit action during the manual check (pages, content, media upload, navigation,
  globals, templates, settings tabs, generation start, share link) — the effective-role trick only covers controls
  that use the role; list any exceptions fixed in the implementation notes.

## Implementation notes

- **Effective role, once:** `AuthStore.roleFor` — instance admin → `PROJECT_ADMIN` (like the server; also lets admins
  open projects they aren't members of, which the route guard refused before), archived project → `VIEWER`.
  `AuthStore.archivedProjects` is the one archived flag, fed by `ProjectContextStore.loadFor` through
  `ProjectAccessStore.enterProject` and by the admin projects page.
- **Read-only, once:** `ProjectAccessStore.readOnly` (time travel or archived) replaced the 26
  `readOnly = timeTravel.isTimeTravel` aliases (pages, media, navigation, globals list, templates, channels, every
  settings tab, tree nodes, UID rename); `readOnlyLabel` gives the right notice ("Viewing a past revision" vs
  "Archived project"). Role-gated editors (records, record sets, datasets, content, global sets, search reindex, members)
  follow the effective role.
- **Found by the walk and fixed:** generation "New generation"/"Promote" (were ungated; cancel stays allowed), preview
  "Share" (disabled when archived), revision "Restore this asset"/rollback (disabled when archived), three
  "Viewing a past revision" notices that showed in archived projects, the members tab bypassing archived mode for
  instance admins.
- `sf-archived-banner` in the project shell, with Unarchive for instance admins; dashboard shows an "Archived" chip.
- Audit filters live in the URL (`admin-audit.util.ts`: `action` repeatable, `user`, `project` incl. `_instance`,
  `from`/`to` as local days — `to` inclusive, sent as the next local midnight).
- Manual check: a scripted Playwright walk against the dev server, not kept in the repo — `M26.5.2` turns it into the
  journey (create user with generated password + membership → forced change →
  my account → members read-only → promote with a live session (no sign-out) → archive: member loses it, admin sees
  banner and disabled pages/content/media/templates/members/generation → unarchive → audit → disable/enable/delete),
  green three runs in a row.
