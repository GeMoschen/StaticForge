---
id: M12.2.1
status: todo
depends: []
epic: m12-asset-metadata-and-creation-ux
feature: create-asset-dialog
area: frontend
---

# M12.2.1 — Shared "Create asset" dialog component

## Context

`pages-list.component.ts`'s `openNewPage()`/`closeNewPage()`/`submitNewPage()`
plus its `newPageForm` (a reactive form: `displayName` + `templateUuid`) and
`newPageOpen` signal is the best existing reference for what a real creation
modal in this codebase looks like — it's just not shared. `DialogService`
(`ui/src/app/core/ui/dialog.service.ts`) is the existing shared modal
primitive, but its `open({ title, message, confirmLabel, cancelLabel, kind })`
API is a plain confirm/message shape with no way to host arbitrary form
content — extending it to support forms would either overload a
purpose-built confirm dialog with unrelated responsibilities, or require a
breaking API change to every existing `dialog.open(...)` call site
(`project-settings-url-registry.component`'s reset confirmations,
`media-detail-drawer.component`'s delete confirmation). A new, separate
component is the cleaner fit.

## Goals

- New standalone component, e.g. `sf-create-asset-dialog`
  (`ui/src/app/shared/components/`), modeled on `pages-list.component`'s
  existing new-page panel but generalized:
  - Inputs: what's being created (a discriminated shape covering `FOLDER`
    [scope: PAGES/MEDIA/NAVIGATION], `PAGE`, `PAGE_TEMPLATE`,
    `SECTION_TEMPLATE`, `PAGE_REFERENCE`), the target parent
    folder/context, and the project key.
  - Renders only the fields relevant to what's being created — a name field
    is universal; a template picker only for `PAGE`; a target picker only for
    `PAGE_REFERENCE`; nothing extra for `FOLDER`/templates beyond name (and,
    for templates, whichever kind wasn't already fixed by the caller's
    context, if that's ever ambiguous — check `templates.component`'s
    `kind()` toggle to see whether kind is always already known before the
    dialog opens).
  - Emits a "created" event with the new asset's identity (or delegates the
    actual create API call to the caller via an output + the form's values —
    pick whichever keeps this component free of per-screen API knowledge;
    the cleaner shape is probably "the dialog collects and validates input,
    the caller performs the actual create call," so this component doesn't
    need to know about five different services).
  - Validation: a required, non-blank name at minimum; whatever extra
    validation each field needs (e.g. a template must be selected for a
    page) surfaced inline, not as a toast-only failure.
  - Loading state while the caller's create call is in flight (a `creating`
    input or an internal signal driven by an input `Observable`/promise —
    match whatever async-boundary pattern reads cleanest given the "caller
    performs the create call" design above).
  - Cancel closes with no side effects.
- Visual/interaction quality matching `media-detail-drawer.component`'s
  panel (or `pages-list.component`'s current new-page panel, whichever is
  the better starting point once compared side by side) — a true overlay
  modal (backdrop + focus trap + Escape-to-close), not an inline expanding
  panel, since it needs to work identically from five different screens with
  different existing layouts.

## Acceptance criteria

- [ ] The component renders correctly for all five creation kinds listed
      above, showing only the relevant fields for each.
- [ ] Keyboard interaction: Escape closes it, Enter submits when the form is
      valid, focus starts on the name field.
- [ ] A component test covers at least: field visibility per kind, validation
      blocking submit, and the emitted create-request shape for one
      representative kind (e.g. `PAGE`).

## Out of scope

- Wiring this into the five actual creation call sites — `M12.2.2`.
- Any change to `DialogService`'s existing confirm/message API — untouched,
  this is a new, separate component per the Context above.

## Notes / hazards

- Resist making this a kitchen-sink form with every possible field for every
  possible type always present-but-hidden — per the epic's own exit
  criteria, it must feel purpose-built per creation kind, not like a single
  giant form with conditional visibility bolted on. Structure the template
  so adding a sixth creation kind later doesn't require touching every
  existing branch.
