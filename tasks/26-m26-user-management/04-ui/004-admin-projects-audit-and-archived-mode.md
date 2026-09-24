---
id: M26.4.4
status: todo
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
  backend answers `409 SF-DOM-0130` anyway — surface that message if it slips through).
- **Dashboard:** instance admins see archived projects with an "Archived" chip; members never see them (the API
  omits them).

## Acceptance criteria

- [ ] Vitest specs: projects table actions and confirmations, audit filter → query params round trip, effective-role
      downgrade for archived projects (a representative editor, e.g. page editor + record editor become read-only),
      banner visibility per role.
- [ ] Manual check in the running app: archive a project as admin → banner, no edit control enabled in pages,
      content, templates, settings, generation; as a member the project is gone; unarchive restores it.
- [ ] `npm run build` green.

## Out of scope

- Archive semantics beyond decision 12 (e.g. deleting projects).

## Notes / hazards

- Walk every feature's primary edit action during the manual check (pages, content, media upload, navigation,
  globals, templates, settings tabs, generation start, share link) — the effective-role trick only covers controls
  that use the role; list any exceptions fixed in the implementation notes.
