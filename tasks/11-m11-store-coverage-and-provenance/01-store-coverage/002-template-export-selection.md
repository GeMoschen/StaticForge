---
id: M11.1.2
status: todo
depends: []
epic: m11-store-coverage-and-provenance
feature: store-coverage
area: backend
---

# M11.1.2 — Template entries reachable via selective export

## Context

`PAGE_TEMPLATE`/`SECTION_TEMPLATE` assets live outside any folder tree (no
`FolderScope` applies to them — confirm via `FolderScope.requiredFor`), but
`resolveIncludedAssetIds`'s non-folder branch (a picked UUID that isn't a
`FOLDER` is included as-is) is asset-type-agnostic and should already handle
a lone template pick correctly. The ancestor-walk step (which adds every
`getFolderId()` parent up to root) needs to degrade gracefully when a
template's `folderId` is `null` — it should already, since the loop condition
is `while (folderId != null ...)`, but this must be confirmed, not assumed.

## Goals

- New integration test covering:
  - Selecting a single `SECTION_TEMPLATE` (or `PAGE_TEMPLATE`) UUID with no
    folder involved exports just that one asset — no spurious ancestor
    folder is pulled in, since templates have no folder chain.
  - Selecting a `PAGE_TEMPLATE` together with a `PAGE` that references it
    (`templateRef`) exports both, and on import the page's `templateRef`
    correctly remaps to the imported template's (possibly-new-on-collision)
    UUID — exercising the existing `UuidRemapper` path, not new logic.
  - Selecting only the `PAGE` (not its template) still produces the existing
    `M10.2` `MISSING_TEMPLATE_REFERENCE` conflict on analyze — confirming
    `M10.1.1`'s "don't auto-include templates" decision still holds and
    interacts correctly with template selection now being possible.
- Fix only whatever gap a failing test reveals.

## Acceptance criteria

- [ ] All three tests above pass.
- [ ] A lone template selection produces zero ancestor-folder entries in the
      exported `assets.json`.
- [ ] No change to `M10.1.1`'s deliberate non-auto-inclusion of a
      page's/section's template reference.

## Out of scope

- Template *compilation/validation* behavior (`TemplateService`) — untouched.
- The one-click "select entire template store" convenience — templates have
  no store/tree concept the way Pages/Media/Navigation do (no `FolderScope`),
  so `M11.1.3`'s per-`FolderScope` expansion does not apply to them; if a
  "select all templates" convenience is wanted later, it would need a
  different mechanism (a plain type-based bulk pick) and is not part of this
  task or `M11.1.3`.

## Notes / hazards

- Confirm `FolderScope.requiredFor(AssetType.PAGE_TEMPLATE)` /
  `requiredFor(AssetType.SECTION_TEMPLATE)` actually return `null` before
  writing the test (don't assume from this doc alone) — that null-ness is
  exactly what makes the "templates aren't foldered" premise true.
