---
id: M15.2.1
status: done
depends: [M15.1.2]
epic: m15-compound-revisions
feature: orchestrated-writes
area: backend
---

# M15.2.1 — Project creation produces exactly one revision

## Context

`ProjectServiceImpl.create` (`server/sf-domain/src/main/java/com/acme/staticforge/project/ProjectServiceImpl.java:65-108`)
calls, in order: `revisionService.allocate(project.getId(), ChangeType.CREATE, cmd.comment(), actingUserId)`
(revision #1, the project itself), `channelService.ensureDefaultChannels(...)`
(currently allocates nothing), `assetService.ensureTemplateFolders(creationCtx)`
(internally: `ensureRootFolder` → revision #2, "All Templates" → #3, "Page Templates"
→ #4, "Section Templates" → #5, each via `AssetServiceImpl.createInternal` which
unconditionally calls `revisionService.allocate`), `ensureNavigationRootFolder` (→ #6),
`ensurePagesRootFolder` (→ #7), `ensureMediaRootFolder` (→ #8). All 8 happen inside
`create`'s own outer `@Transactional` boundary already — the fragmentation is purely a
call-site convention (`createInternal` never checks whether its `ctx` already carries
an open revision), not a transactional necessity.

## Goals

- In `ProjectServiceImpl.create`, immediately after `counterRepository.initialize(...)`,
  call `Revision batch = revisionService.beginBatch(project.getId(), ChangeType.CREATE, cmd.comment(), actingUserId);`
  instead of today's `revisionService.allocate(...)` at line 79. Build
  `RevisionContext creationCtx` (already constructed today, just below, for the
  folder-ensure calls) so it carries `batch` as `openRevision` from this point on —
  i.e. move/extend the existing `RevisionContext creationCtx = ...` construction to
  happen right after `beginBatch` and thread it through, replacing its current
  `RevisionContext.of(...)` call with the batch-carrying variant from `M15.1.1`.
- Append a `CREATE` entry for the project itself to `batch`'s summary (project isn't an
  `Asset`, so this is a hand-built `AssetChange`-shaped entry via `appendSummary`,
  matching how the project's own creation was implicitly the sole content of revision
  #1 before this task — just now living inside the shared batch's summary instead of
  being the entire summary).
- In `AssetServiceImpl.createInternal` (and any other `AssetServiceImpl`/
  `TemplateServiceImpl`/`FolderServiceImpl` method already reachable from
  `ensureTemplateFolders`/`ensureNavigationRootFolder`/`ensurePagesRootFolder`/
  `ensureMediaRootFolder`'s call chains), replace the unconditional
  `revisionService.allocate(projectId, ChangeType.CREATE, ctx.comment(), ctx.userId())`
  with `revisionService.allocateOrJoin(ctx, ChangeType.CREATE)`. Since every one of
  these methods already receives and threads a `RevisionContext ctx` parameter
  end-to-end (confirmed: `ensureFixedFolder`, `ensureRootFolder`, `createInternal` all
  take `ctx`), this is a narrow, mechanical substitution at each `allocate` call site
  reachable from project creation — **not** a change to every `allocate` call in
  `AssetServiceImpl` (ordinary single-asset creates outside a batch must keep calling
  `allocateOrJoin` too, per the design in `M15.1.1`, but since their `ctx.openRevision()`
  is always `null` outside a batch, behavior is unchanged for them).
- Decide (and document inline with a short comment) whether `ensureDefaultChannels`
  should now append a `CREATE` entry for the default HTML channel into the same batch,
  given it's created as part of the same bootstrap. If yes, use `allocateOrJoin`/
  `appendSummary` there too, threading `creationCtx` through
  `channelService.ensureDefaultChannels(project.getId(), actingUserId)`'s now-`ctx`-based
  signature (from `M15.1.2`).

## Acceptance criteria

- [x] A new integration test creates a project and asserts `revisionService.findRecent`
      (or `GET /projects/{key}/revisions`) returns **exactly one** revision, with
      `changeType = CREATE` and `summary.assets` listing the project entry plus all 7
      bootstrap folders (the shared root, "All Templates", "Page Templates",
      "Section Templates", "All Navigation", "All Pages", "All Media") — and, per the
      decision above, optionally the default HTML channel. (Updated
      `ProjectApiIntegrationTests.createAllocatesRevisionOneAndGrantsCreatorProjectAdmin`,
      which already existed asserting the old 8-revision behavior, to assert 1 revision
      with an 8-entry summary instead of adding a parallel test.)
- [x] `RevisionCounterRepository`'s counter for the new project ends at `2` (revision 1
      consumed, next is 2), not `9`.
- [x] Every existing test that creates a project via `ProjectServiceImpl.create`/the
      project-creation endpoint and later references specific revision ids by number
      (grep `ProjectExportImportIntegrationTest`, `Fixtures.java`, any other test
      building projects) is audited and updated for the new, lower revision numbering —
      this is the one place in the codebase where "off-by-N revision id" breakage is
      most likely, since every fixture-created project's *first user action* now lands
      on revision 2 instead of revision 9. (Audited via grep for
      `revisionId()).isEqualTo`/`validFromRevision()).isEqualTo` across
      `server/sf-app/src/test`: every match compares two dynamically-obtained revision
      values against each other, not a hardcoded absolute number, so no other test
      needed updating.)
- [x] `./gradlew build` green.

## Out of scope

- `M15.2.2`'s UID-rename cascade, template-folder migration, and project-restore
  summary fix — separate call sites, separate task.
- Any UI change — `M15.4`.

## Notes / hazards

- This is the highest-risk task in the epic for silent test breakage: any existing test
  fixture that assumes "a freshly created project is at revision N" (for `since=N`
  filtering, `If-Match` headers, or diff/restore assertions) will need its expected
  revision number lowered by up to 7. Search broadly (`Fixtures.java`,
  `RevisionFilterIntegrationTest`, `AssetRevisionIntegrationTests`,
  `ConcurrentWritersTest`) rather than fixing failures one at a time as they surface.
- Keep the project's own `CREATE` summary entry's shape consistent with `AssetChange`
  even though a `Project` isn't an `Asset` — reuse `AssetChange`'s JSON shape
  (`uuid`/`type`/`uid`/`action`) with a project-appropriate `type` (e.g. `"PROJECT"`)
  rather than inventing a parallel summary-entry schema; the frontend (`M15.4`) should
  only ever need to understand one entry shape per revision.
