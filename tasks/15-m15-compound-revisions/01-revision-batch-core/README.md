# Feature: Revision batch core

**Spec:** Extends §7.1/§7.2/§21.2/§21.3 — the mechanism by which a revision is opened
and written to, not the revision record's shape (already list-shaped).

## Goal

Give every mutating service an explicit, opt-in way to append a change to an
**already-open** revision instead of always allocating a fresh one, without touching
the behavior of any call site that doesn't opt in (today's single-asset-per-revision
call sites must keep working byte-for-byte unchanged).

The mechanism is parameter-threaded, not ambient/thread-local — consistent with how
`RevisionContext` already flows explicitly through every `@RevisionAware` service
method in this codebase (`AssetServiceImpl`, `TemplateServiceImpl`,
`FolderServiceImpl`, `PageServiceImpl`, `MediaServiceImpl` already take a
`RevisionContext ctx` parameter; `ChannelServiceImpl`/`ProjectServiceImpl` take loose
`(projectId, comment, actingUserId)` params instead and get unified onto
`RevisionContext` as part of this feature).

`RevisionContext` (`server/sf-domain/.../revision/RevisionContext.java`) gains an
optional already-open `Revision`:

```java
public record RevisionContext(long projectId, Long userId, String comment, Revision openRevision) {
    public static RevisionContext of(long projectId, Long userId, String comment) {
        return new RevisionContext(projectId, userId, comment, null);
    }
}
```

`RevisionService` gains the two operations that make a batch usable:

```java
Revision beginBatch(long projectId, ChangeType type, String comment, Long userId);
Revision allocateOrJoin(RevisionContext ctx, ChangeType type);
```

`allocateOrJoin` returns `ctx.openRevision()` when present, otherwise behaves exactly
like today's `allocate(ctx.projectId(), type, ctx.comment(), ctx.userId())`. An
orchestrating method calls `beginBatch(...)` once, builds a `RevisionContext` carrying
that `Revision` as `openRevision`, and passes that single context down into every
nested service call it makes — those nested calls, once migrated (feature 2) to call
`allocateOrJoin(ctx, type)` instead of `allocate(...)`, transparently join the batch.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-revision-context-batch.md](001-revision-context-batch.md) | — |
| 2 | [002-unify-channel-project-contexts.md](002-unify-channel-project-contexts.md) | 1 |

## Feature exit criteria

- [x] `RevisionContext` carries an optional already-open `Revision`; `RevisionService`
      exposes `beginBatch`/`allocateOrJoin` alongside the existing `allocate`/
      `appendSummary` (neither existing method's signature or behavior changes).
- [x] `ChannelServiceImpl` and `ProjectServiceImpl` accept/build `RevisionContext`
      instead of loose `(projectId, comment, actingUserId)` parameters, matching every
      other `@RevisionAware` service.
- [x] No call site is changed to actually *use* `allocateOrJoin`/`beginBatch` yet in
      this feature — that migration, including project creation becoming one revision,
      is feature 2. This feature only builds and unit-tests the mechanism.

## Dependencies

`M1:revision` (`Revision`, `RevisionService`, `RevisionContext`, `RevisionCounterRepository`,
`@RevisionAware`/ArchUnit gate — unaffected, since this feature adds methods rather than
removing the repository-write gate any class must still carry).
