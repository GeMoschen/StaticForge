# Feature: Revision invariants under compound revisions

**Spec:** §25.5 (property-based revision invariants), §25.3 (test data builders).

## Goal

The five property-based invariants proved in `M1.7.2`
(`server/sf-app/src/test/java/com/acme/staticforge/RevisionInvariantsTest.java`) —
gapless revisions, exactly one valid version per asset per revision, reproducible
reads, correct restore, no lost updates — were written and verified against a world
where every revision touches exactly one asset. None of the five actually *require*
that assumption (invariant 2 in particular is already stated per-asset, not
per-revision: "for every asset and revision R, exactly 0 or 1 version row valid"), but
the jqwik generators that exercise them only ever produce single-asset operations
today. This feature extends the generators and re-verifies the invariants hold when a
generated "operation" can be a batch of N asset changes committed as one revision —
proving the compound-revision refactor (`M15.1`, `M15.2`) didn't quietly break the
correctness guarantees the whole revision system depends on — and adds targeted
integration-test coverage for the two concrete regressions the epic's other features
introduce (project creation's revision count, `ProjectRestoreService`'s summary).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-compound-batch-property.md](001-compound-batch-property.md) | `M15.2` |
| 2 | [002-integration-regression-audit.md](002-integration-regression-audit.md) | `M15.2` |

## Feature exit criteria

- [x] `RevisionInvariantsTest`'s jqwik model includes a "batch of N asset operations,
      one revision" generated action alongside the existing single-asset actions, and
      all five invariants hold across property runs that include it.
- [x] `AssetRevisionIntegrationTests`, `ConcurrentWritersTest`, and
      `RevisionFilterIntegrationTest` are audited for any assumption of exactly-one-
      asset-per-revision and updated or explicitly confirmed unaffected.
- [x] `./gradlew build` green, including the 16-virtual-thread concurrency harness.

## Dependencies

`M1:revision-invariants` (`RevisionInvariantsTest`, the jqwik model and test-data
builders it extends), `M15.1`, `M15.2` (the mechanism and call sites being verified).
