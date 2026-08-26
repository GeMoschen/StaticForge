# Feature: Caller project scoping

**Spec:** Implementation follow-through on §6.1/§10 — every existing API route that
resolves an asset by UUID already carries a project in its path
(`/projects/{p}/assets/{uuid}`); this feature makes the query layer match that shape.

## Goal

Every production call site that currently resolves an asset by a bare UUID
(`AssetRepository.findByUuid` and the ~15 files found referencing UUID-keyed asset
lookups: template resolution, preview, navigation, the URL registry, channels, content
references, folders, media, pages, export/import) must move onto the project-scoped
finder from `M9.1.2`, using the project ID it already has in scope from the request or
service context.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-migrate-lookup-call-sites.md](001-migrate-lookup-call-sites.md) | M9.1.2 |
| 2 | [002-cross-project-collision-test.md](002-cross-project-collision-test.md) | 1 |

## Feature exit criteria

- [ ] No production code resolves an asset by UUID without also supplying the project
      it's looking in.
- [ ] A cross-project collision test (two projects, one shared UUID) exercises
      revision history, template resolution, generation, preview, and the URL registry
      end-to-end with no leakage between the two projects.

## Dependencies

`M9.1` (schema + repository finder must exist before callers can migrate onto it).
