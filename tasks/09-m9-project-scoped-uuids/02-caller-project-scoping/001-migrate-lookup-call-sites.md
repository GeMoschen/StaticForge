---
id: M9.2.1
status: todo
depends: [M9.1.2]
epic: m9-project-scoped-uuids
feature: caller-project-scoping
area: backend
---

# M9.2.1 — Migrate UUID lookup call sites to project scope

## Context

A repo search for UUID-keyed asset lookups turns up production code in at least:
`asset/template/TemplateServiceImpl`, `preview/PageRenderService`,
`urlregistry/UrlRegistryServiceImpl`, `urlregistry/LiveOutputPathResolver`,
`asset/AssetServiceImpl`, `asset/navigation/PageReferenceServiceImpl`,
`asset/navigation/LiveNavigationLookup`, `exportimport/ProjectExportImportServiceImpl`,
`asset/folder/FolderServiceImpl`, `asset/content/ContentReferenceService`,
`asset/media/MediaServiceImpl`, `asset/page/PageServiceImpl`,
`channel/ChannelServiceImpl`, `revision/DiffServiceImpl`, plus
`asset/AssetRepository` itself. Every one of these currently either calls
`findByUuid(UUID)` directly or goes through a service method that does.

## Goals

- For each call site above: confirm the enclosing method already has (or can trivially
  obtain from its caller) the `projectId` for the operation — per the epic's premise,
  every API route already carries it — and switch the lookup to
  `findByProjectIdAndUuid(projectId, uuid)`.
- Where a service method doesn't currently take a `projectId` parameter but is only
  ever called from a context that has one (e.g., a controller resolves
  `{projectKey}` first), thread it through rather than reaching for some other
  global-lookup shortcut.
- Resolve `AssetRepository.findByUuid(UUID)`'s fate per `M9.1.2`'s decision — remove it
  and fix the resulting compile errors one call site at a time (preferred, since the
  compiler then finds every remaining caller for you), or leave a documented
  exception if one genuinely-global use case survives the audit.
- `payload.origin`-based reference remapping in `exportimport` (`UuidRemapper`) and
  cross-project reference resolution generally must resolve *within the project the
  reference lives in*, not by bare UUID — audit `UuidRemapper` and its callers
  specifically, since this is the piece `M10` (selective export/import) depends on
  most directly.

## Acceptance criteria

- [ ] `AssetRepository.findByUuid(UUID)` has zero production callers left (removed, or
      the single retained caller is documented per `M9.1.2`).
- [ ] Full backend test suite passes after the migration — a caller that silently
      relied on global uniqueness will show up as a new failure here, not later.
- [ ] `git grep -n "findByUuid("` across `server/` (excluding the repository
      declaration itself and test fixtures deliberately exercising the global case)
      returns nothing in production code.

## Out of scope

- The cross-project collision test itself (`M9.2.2`) — this task's own acceptance
  criteria only require the existing suite to stay green, not add new coverage.
- Import UUID-preservation behavior change (`M9.3`) — this task is purely "make
  existing lookups project-scoped," not "change what import does with UUIDs."

## Notes / hazards

- This is the highest-risk task in the epic by sheer surface area — go file by file,
  run the suite after each, and don't batch unrelated files into one sweep; if
  something breaks, you want to know which of the ~15 files caused it.
- Watch for lookups that resolve a UUID from a payload reference (media refs, page
  refs, template refs inside JSON content) without an obvious `projectId` in the
  immediate method signature — trace up to the nearest caller that has one rather than
  adding a new global fallback query.
