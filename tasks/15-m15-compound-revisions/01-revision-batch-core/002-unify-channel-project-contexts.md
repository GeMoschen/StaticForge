---
id: M15.1.2
status: done
depends: [M15.1.1]
epic: m15-compound-revisions
feature: revision-batch-core
area: backend
---

# M15.1.2 — Unify `ChannelServiceImpl`/`ProjectServiceImpl` onto `RevisionContext`

## Context

Every other `@RevisionAware` mutating service (`AssetServiceImpl`, `TemplateServiceImpl`,
`FolderServiceImpl`, `PageServiceImpl`, `MediaServiceImpl`) already threads a
`RevisionContext ctx` parameter through its write methods. `ChannelServiceImpl`
(`server/sf-domain/src/main/java/com/acme/staticforge/channel/ChannelServiceImpl.java`,
methods `create`/`update`/`setEnabled`/`delete`/`seedFrom` around lines 76-321) and
`ProjectServiceImpl` (`server/sf-domain/.../project/ProjectServiceImpl.java`, methods
`create`/`update`/`updateAllowedMimeTypes`/`grantRole`/`revokeRole` — grep confirms 6
raw `revisionService.allocate(projectId, ChangeType.X, comment, actingUserId)` call
sites) instead take loose `(long projectId, ..., Long actingUserId, String comment)`
parameters and call `revisionService.allocate(...)` directly with those. This is the
last piece needed before `M15.2.1` can wrap `ProjectServiceImpl.create`'s whole body
in one `RevisionContext` and have `ChannelServiceImpl.ensureDefaultChannels` join it —
without this task, `ChannelServiceImpl` has no `ctx` parameter to join through at all.

## Goals

- Change every mutating `ChannelServiceImpl` and `ProjectServiceImpl` method to accept
  a `RevisionContext ctx` in place of its separate `actingUserId`/`comment` (and, where
  present, `projectId`) parameters, mirroring the exact shape used by
  `AssetServiceImpl.update(UUID uuid, UpdateAssetCommand cmd, long expectedRevision, RevisionContext ctx)`.
  Replace each internal `revisionService.allocate(projectId, ChangeType.X, comment, actingUserId)`
  call with `revisionService.allocate(ctx.projectId(), ChangeType.X, ctx.comment(), ctx.userId())`
  — same behavior, new parameter source.
- Update every caller of these methods (`ChannelController`, `ProjectController`,
  `ProjectServiceImpl.create`'s own `channelService.ensureDefaultChannels(...)` call,
  and any test fixture/builder in `Fixtures.java`) to build a `RevisionContext.of(...)`
  at the call site instead of passing the raw trio.
- `ensureDefaultChannels(long projectId, Long actingUserId)` specifically: give it the
  same `RevisionContext ctx` treatment even though it currently allocates **no**
  revision at all (channel bootstrap isn't revision-tracked today) — `M15.2.1` needs it
  to accept a ctx so it *can* be folded into the project-creation batch if/when default
  channels become revision-tracked; whether it actually calls `appendSummary` for the
  default HTML channel is `M15.2.1`'s decision, not this task's.

## Acceptance criteria

- [x] `ChannelServiceImpl` and `ProjectServiceImpl` have zero remaining methods that
      take `Long actingUserId`/`String comment` as separate parameters where a
      `RevisionContext` could carry both — signatures match the `RevisionContext ctx`
      convention used elsewhere.
- [x] Every call site (controllers, `Fixtures.java`, any other production or test code)
      compiles against the new signatures.
- [x] No behavior changes yet: every existing test in `ChannelServiceTest`,
      `ProjectExportImportIntegrationTest` (which creates projects/channels as fixture
      setup), and any project/channel controller integration test passes unmodified in
      *assertions* (only construction of `RevisionContext` at call sites changes).
- [x] `./gradlew build` green. (verified via targeted `:server:sf-domain:test` and
      `:server:sf-app:test` runs at this point; full `./gradlew build` run once more at
      the end of the epic's feature 2 work.)

## Out of scope

- Actually wrapping `ProjectServiceImpl.create` in a batch — `M15.2.1`.
- Deciding whether default-channel creation becomes revision-tracked — `M15.2.1`.

## Notes / hazards

- This is a mechanical signature refactor with real reach (controllers + tests) — do it
  as one focused pass per class, verifying compilation after each, rather than editing
  both classes' many call sites interleaved.
- Keep `RevisionContext.of(projectId, userId, comment)` as the construction path at
  every call site in this task — none of them are opening or joining a batch yet, so
  `openRevision` stays `null` throughout this task's changes.
