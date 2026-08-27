---
id: M12.1.2
status: todo
depends: []
epic: m12-asset-metadata-and-creation-ux
feature: asset-metadata-editing
area: frontend
---

# M12.1.2 — Template UID and metadata editing

## Context

`ui/src/app/features/templates/templates.component.ts`'s `newTemplate()`
creates a template immediately with a hardcoded placeholder name ("New page
template"/"New section template") and no dialog (see `M12.2` for the
creation-side fix) — and today there is **no way to rename it afterward**
either: no UID-rename control, no display-name edit, anywhere in this
component. A newly created template is stuck with its placeholder name
unless renamed through some other, indirect path.

## Goals

- Add a metadata section to the template detail view inside
  `templates.component` (whatever its current per-selected-template detail
  panel is — read the component/template fully first to find where this
  belongs structurally).
- Reuse `sf-uid-rename` for the UID, exactly as the other detail screens do.
- Add `displayName` editing backed by `TemplatesService`'s existing update
  method (check its exact name/shape — `templates.component.ts` already
  calls `this.service.create(...)`, so its sibling update method is the one
  to reuse here, not a new endpoint).

## Acceptance criteria

- [ ] A template's UID can be changed from the templates screen.
- [ ] A template's display name can be edited and saved.
- [ ] Both page and section template kinds (`templates.component`'s
      `kind()`/`switchKind`) get the same metadata section — this is one
      component handling both, not two separate implementations.

## Out of scope

- Any change to the template's content/OCTL editing UI — untouched.
- The channel-source editing UI already present — untouched, this task only
  adds identity/display-name editing alongside it.

## Notes / hazards

- `sf-uid-rename` already surfaces a warning when a UID change affects OCTL
  templates that reference the old UID literally (`AffectedTemplate`,
  `UidChangeResult.affectedTemplates`) — this warning is even more relevant
  here than on Media, since templates are exactly what gets referenced by
  literal UID in OCTL source (`page:old_uid`, etc., per spec §16.4). Confirm
  the existing warning UI in `sf-uid-rename` renders correctly in this
  context rather than assuming it "just works" because it's a shared
  component.
