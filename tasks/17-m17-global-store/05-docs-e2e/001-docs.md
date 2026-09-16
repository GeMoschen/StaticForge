---
id: M17.5.1
status: done
depends: [M17.3.1, M17.4.1]
epic: m17-global-store
feature: docs-e2e
area: fullstack
---

# M17.5.1 — Documentation: Globals store, `global:` / `CMS_GLOBAL`, API, spec follow-up

## Context

- **Developer docs.** `docs/template-developer-guide.md`: §2.1 instruction table, §2.5
  scopes, §3 diagnostics tables. Per-editor reference in `docs/editors/`.
- **Other docs.** `docs/user-guide.md` (Elena/Paul), `docs/api.md` (endpoint catalogue),
  `docs/architecture.md` §3 (domain model).
- **Spec.** `cms-specification.md` §3 glossary (asset type list), §16.4/§16.5. Earlier
  epics (`M8`, `M13`, `M15`) handled spec drift as a documentation follow-up.

## Goals

- **Template developer guide:**
  - A new section "Global property sets": CDL restrictions (no `body`, no `catalog`),
    `$CMS_VALUE(global:site.title)$` vs `$CMS_VALUE(CMS_GLOBAL.site.title)$`, use in
    `$CMS_IF`/`$CMS_FOR`/`$CMS_REF`, the flat uid namespace (folders don't matter),
    the uid-rename warning.
  - A note that a set read by a page template makes every page depend on it (large
    incremental runs are expected).
  - The new CDL diagnostic code in §3.2, and any new OCTL diagnostic in §3.1.
  - A worked example: a `site` set with a title, logo and social links, plus a page
    template header/footer using it.
- **User guide:** the Globals store screen, the Values vs Schema tabs, who can edit what,
  and that each save is a revision (restorable from history).
- **API doc:** the `/globals` endpoints (from `M17.2.1`), and that folders use `/folders?scope=GLOBALS`.
- **Architecture doc:** add `GLOBAL_SET`/`GLOBALS` to §3, and note the `asset.globals`
  package in the module table.
- **Spec follow-up:**
  - §3 glossary: `GLOBAL_SET` in the asset-type list, and a new term "Property set".
  - §16.4 prefix list: `global`.
  - §16.5 scopes: `CMS_GLOBAL`.
  - Keep changes minimal and factual, as in the `M8`–`M15` doc follow-ups.

## Acceptance criteria

- [ ] The template developer guide has the Globals section, the worked example and updated
      diagnostics tables.
- [ ] The user guide documents the Globals screen and role split.
- [ ] `docs/api.md`, `docs/architecture.md` and `cms-specification.md` §3/§16.4/§16.5 are
      updated.
- [ ] Every snippet in the docs has been checked against a real render (copy the worked
      example into the `M17.5.2` integration fixture, so the docs can't drift from behavior).

## Out of scope

- Localization docs for globals (`M24.6.1`).

## Notes / hazards

- Use the accessor-root form `$CMS_VALUE(CMS_GLOBAL.site.title)$` consistently. Don't
  document a standalone `$CMS_GLOBAL.site.title$` instruction; it doesn't exist (see
  epic Notes).
