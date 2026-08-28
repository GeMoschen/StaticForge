---
id: M15.1.1
status: done
depends: []
epic: m15-compound-revisions
feature: revision-batch-core
area: backend
---

# M15.1.1 — `RevisionContext.openRevision` + `RevisionService.beginBatch`/`allocateOrJoin`

## Context

`RevisionContext` (`server/sf-domain/src/main/java/com/acme/staticforge/revision/RevisionContext.java`)
is currently `record RevisionContext(long projectId, Long userId, String comment)` — a
pure input bag, carrying nothing about an in-progress revision. `RevisionService`
(`revision/RevisionService.java`, impl `RevisionServiceImpl.java`) only ever hands out
a *brand-new* revision id from `allocate(...)`; nothing in the interface lets a caller
say "give me the revision that's already open for this operation." Every one of today's
~20 `revisionService.allocate(...)` call sites (`AssetServiceImpl`, `TemplateServiceImpl`,
`FolderServiceImpl`, `ChannelServiceImpl`, `ProjectServiceImpl`, `ProjectExportImportServiceImpl`,
`ProjectRestoreService`) therefore always allocates unconditionally.

## Goals

- Add a fourth, nullable component to `RevisionContext`: `Revision openRevision`. Keep
  the existing `RevisionContext.of(projectId, userId, comment)` factory (sets
  `openRevision` to `null`), and add `RevisionContext.joining(Revision openRevision, Long userId, String comment)`
  (or equivalent) for building a context that already carries a batch's open revision.
- Add to `RevisionService`:
  - `Revision beginBatch(long projectId, ChangeType type, String comment, Long userId)`
    — identical to `allocate(...)` today (same counter allocation, same empty-`assets`
    summary), just named to signal "this revision is meant to be reused by several
    subsequent calls," and documented as such.
  - `Revision allocateOrJoin(RevisionContext ctx, ChangeType type)` — returns
    `ctx.openRevision()` unchanged when non-null; otherwise calls
    `allocate(ctx.projectId(), type, ctx.comment(), ctx.userId())` exactly as today.
    The `type` parameter is intentionally ignored when joining an existing batch — the
    batch's own `ChangeType`, chosen once at `beginBatch` time, is authoritative for the
    whole container; a caller joining an open `CREATE` batch with what would locally
    have been a `MOVE` doesn't get a second, conflicting `ChangeType`.
- Unit tests directly against `RevisionServiceImpl` (no need for a full Spring context):
  `allocateOrJoin` with a null `openRevision` allocates a fresh counter value (same as
  `allocate`); `allocateOrJoin` with a non-null `openRevision` returns that exact
  instance and does **not** touch `RevisionCounterRepository` (verify via a mock/spy —
  this is the core "no extra counter increment" guarantee compound revisions depend on).

## Acceptance criteria

- [x] `RevisionContext` compiles with the new field; every existing call site that
      constructs one via `RevisionContext.of(...)` is unaffected (still 3 args at the
      call site, `openRevision` defaults to `null` inside the factory).
- [x] `RevisionService.beginBatch` and `.allocateOrJoin` exist with the behavior
      described above; `allocate`/`appendSummary`/`findRecent`/`find` are unchanged.
- [x] New unit tests for `allocateOrJoin`'s two branches (fresh-allocate vs. join) pass,
      including the no-extra-counter-increment assertion for the join branch.
- [x] `./gradlew :server:sf-domain:test` green; no existing test touching
      `RevisionContext`/`RevisionService` needs modification (this task is purely
      additive at the type/interface level).

## Out of scope

- Changing any call site to actually call `beginBatch`/`allocateOrJoin` instead of
  `allocate` — `M15.2.*`.
- `ChannelServiceImpl`/`ProjectServiceImpl`'s loose-parameter-to-`RevisionContext`
  migration — `M15.1.2`.

## Notes / hazards

- Keep `RevisionContext` a `record` — adding a fourth component is a compatible,
  mechanical change as long as every existing positional-constructor call site is
  updated to the factory method instead (grep confirms all current call sites already
  use `RevisionContext.of(...)`, not the raw constructor, so this should be a non-event).
- `allocateOrJoin`'s ignored `type` parameter on the join branch is a deliberate design
  choice, not an oversight — document it with a clear Javadoc so a future caller doesn't
  assume passing a different `ChangeType` on join has any effect.
- Do not remove or deprecate `allocate`/`appendSummary` — `ProjectRestoreService` and
  `ProjectExportImportServiceImpl` keep using bespoke `allocate`-then-loop-`appendSummary`
  patterns until `M15.2.2` migrates them onto the shared mechanism.
