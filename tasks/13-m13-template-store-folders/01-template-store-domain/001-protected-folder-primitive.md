---
id: M13.1.1
status: todo
depends: []
epic: m13-template-store-folders
feature: template-store-domain
area: backend
---

# M13.1.1 — Protected-folder primitive

## Context

No folder anywhere in the app today can resist rename/move/delete — not
even the auto-created Navigation root (`ProjectServiceImpl.create`'s
`folderService.create(null, "Navigation", FolderScope.NAVIGATION, ...)` is a
perfectly ordinary, fully-mutable folder). This milestone's fixed "Page
Templates"/"Section Templates" folders are the first folders that must be
un-rename-able, un-movable, and un-deletable while still allowing children
to be created/renamed/moved/deleted freely inside them. This task adds that
primitive generically in `FolderServiceImpl`, independent of what will later
mark the two template folders protected (`M13.1.2`).

## Goals

- Add a `protected` boolean to the folder payload shape (alongside the
  existing `scope` field written in `FolderServiceImpl.create`), defaulting
  to `false`/absent for every existing and newly-created ordinary folder —
  no behavior change for Pages/Media/Navigation folders.
- `FolderServiceImpl.update` (rename), `move`, and `delete` each check the
  target folder's payload for `protected: true` and reject with a 422
  (`SfException`/`ProblemFactory.unprocessableEntity`, matching the style of
  the existing "A subfolder's store must match its parent folder's." guard)
  before doing any other work.
- `FolderServiceImpl.create` still allows creating a *child* under a
  protected folder — protection blocks mutating the protected folder
  itself, not what lives inside it.
- Surface `protected` on `FolderNode`/`FolderView`
  (`FolderController.toView`) so the frontend (`M13.3`) can hide/disable the
  affected UI affordances without guessing from folder identity.

## Acceptance criteria

- [ ] A folder created with `protected: true` in its payload cannot be
      renamed, moved, or deleted via `FolderServiceImpl`/`FolderController`
      — each attempt returns a 422 with a clear message.
- [ ] A child folder or asset can still be created under a protected
      folder, and that child is fully mutable (not protected itself) unless
      explicitly marked so.
- [ ] Every existing folder (no `protected` key in payload) behaves exactly
      as before — rename/move/delete all still succeed.
- [ ] `GET /folders?scope=...` includes the `protected` flag per node.

## Out of scope

- Deciding *which* folders are protected — that's `M13.1.2`. This task only
  builds the mechanism and proves it against a folder marked protected by
  hand (test fixture), not against any real template folder yet.
- Protecting the hidden global project root (`PathService.ROOT_UID`) — it's
  already implicitly unreachable via the folder APIs (never returned by
  `tree()`, `requireFolder` still finds it by uuid but nothing currently
  calls rename/move/delete on it); leave it alone.

## Notes / hazards

- Keep the check symmetric with the existing cross-scope move guard in
  `FolderServiceImpl.move` (which already inspects both the source and
  target folder's payload before proceeding) — protection should be checked
  on the *folder being mutated*, not on siblings or the destination (moving
  a normal folder *into* a protected one is fine; it's moving/deleting the
  protected folder itself, or renaming it, that's blocked).
