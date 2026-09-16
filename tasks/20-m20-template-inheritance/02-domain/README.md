# Feature: Domain (abstract templates, effective definition, parent-change cascade)

**Spec:** Extends §13 (page template payload and rules), §12.3 (migration on CDL change), §5.4
(reference integrity), §18.1 (incremental scope).

## Goal

Make inheritance a first-class property of page-template assets:

- **`abstract`** flag on page templates. Pages can't use abstract templates. A template in use can't
  become abstract.
- **`parentTemplateRef`**, derived on save from the channel sources' `$CMS_EXTENDS`.
- **Effective content definition**: computed through the chain wherever a template's definition is
  consumed (page editor view, `ContentValidator`, OCTL compile on save).
- **Parent-change safety**: validate all descendants before a parent save commits. Migrate
  `renamedFrom` page content for every descendant in one compound revision.
- **Graph**: a child → parent `TEMPLATE` reference edge, so usages, export dependency expansion and
  incremental builds see the chain.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-abstract-effective-definition.md](001-abstract-effective-definition.md) | `M20.1.2`, `M16.5.2` |
| 2 | [002-parent-change-cascade-graph.md](002-parent-change-cascade-graph.md) | 1; `M16.3.2`, `M16.3.3` |

## Feature exit criteria

- [x] Abstract templates are enforced in `PageServiceImpl` and `TemplateServiceImpl`.
- [x] `parentTemplateRef` is derived and validated on save. The effective definition is served by the
      template API and used by validation and compile-on-save.
- [x] A parent save that breaks a descendant is rejected. `renamedFrom` migrations cover descendants'
      pages in one revision.
- [x] A `TEMPLATE` edge exists child → parent. Planner, usages and export honor it.

## Dependencies

`M20.1.2` (chain compile + effective definition), `M16.5.2` (server-side `ContentValidator`),
`M16.3.2`/`M16.3.3` (template references written on save, revision-aware), `M15` (compound revisions),
`M11` (export provenance: explicit vs implicit picks).
