# Feature: UI — policy settings and permission-gated publishing

**Spec:** Extends §23 (project context, settings), §24 (generation screen, Changes view, schedules).

## Goal

One permission helper for the whole app, a policy card for project admins, and every publishing surface (generation
screen, release bar, Changes view, schedules) showing only what the user may do.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-project-permissions-store.md](001-project-permissions-store.md) | `M28.1.1` |
| 2 | [002-publish-policy-settings.md](002-publish-policy-settings.md) | `M28.3.1` |
| 3 | [003-gated-publishing-surfaces.md](003-gated-publishing-surfaces.md) | `M28.3.1`, `M28.2.1`, `M28.2.2` |

## Feature exit criteria

- [ ] No component derives rights from `ROLE_RANK`/`roleFor` any more; all read `ProjectPermissionsStore`.
- [ ] A project admin edits the policy with implication rules and an impact warning; others see it read-only.
- [ ] Editors see exactly the controls their permissions allow; the generation dialog is restricted accordingly and
      gains a scope picker; runs show comment and who started them.

## Dependencies

`M28.1.1` (`ProjectDetail.permissions`), `M28.2.x` (endpoints and run view fields), M27 UI (release bar, Changes
view, schedules).
