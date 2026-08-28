---
id: M15.3.1
status: done
depends: [M15.2]
epic: m15-compound-revisions
feature: revision-invariants-compound
area: qa
---

# M15.3.1 — Property-based invariant coverage for compound (multi-asset) revisions

## Context

`RevisionInvariantsTest` (`server/sf-app/src/test/java/com/acme/staticforge/RevisionInvariantsTest.java`,
delivered by `M1.7.2`) drives a jqwik property over a generated sequence of operations
against the real revision machinery (via the `M1.7.1` test-data builders), checking the
five invariants from spec §25.5 after every operation and under 16-virtual-thread
concurrent execution. Every generated operation today produces exactly one
`allocate()`-then-single-`appendSummary()` revision. `M15.1`/`M15.2` add a code path
(`beginBatch`/`allocateOrJoin`) where one revision accumulates N asset changes — this
path is currently untested by the property suite.

## Goals

- Add a new generated action to the jqwik model: "commit a batch of N asset operations
  (N generated, e.g. 2-5) as one revision," implemented via
  `revisionService.beginBatch(...)` + a loop of the same underlying asset-mutation
  builder calls the single-asset generators already use, each now passed a joined
  `RevisionContext` instead of a plain one.
- Re-verify each of the five invariants explicitly accounts for the batch action:
  1. **Gapless revisions** — a batch still consumes exactly one counter value, so
     gaplessness is unaffected; assert this explicitly (the batch action must not
     allocate N counter values for its N asset changes).
  2. **Exactly one valid version per asset per revision** — per-asset, already
     compatible; assert it holds for every asset touched by a batch, not just
     single-asset revisions.
  3. **Reproducible reads** — reading project state at the batch's revision id must
     reflect all N asset changes together, atomically (no partial-batch read is ever
     observable, since they share one transaction).
  4. **Correct restore** — restoring any one asset touched by a batch to its
     pre-batch state must work exactly as it does for a single-asset revision.
  5. **No lost updates under concurrency** — run batches concurrently with both other
     batches and ordinary single-asset writes against overlapping and disjoint asset
     sets; total ordering and 409-on-conflict must still hold.
- Extend the test-data builders (`M1.7.1`, wherever they live alongside this test) with
  a batch-committing helper if the existing single-asset builders can't be trivially
  looped under one `RevisionContext` as-is.

## Acceptance criteria

- [x] The jqwik property run (same iteration count/seed policy as today) passes with
      the new batch action included in the generated action set.
- [x] All five invariants have at least one explicit assertion path that only the batch
      action can exercise (i.e., removing the batch action from the generator would make
      that assertion untested) — not just "the existing checks happen to also run after
      a batch action."
- [x] The concurrency harness (16 virtual threads) includes at least one scenario mixing
      concurrent batches and single-asset writes against overlapping assets, asserting
      the expected `409`/serialization behavior.
- [x] `./gradlew :server:sf-app:test --tests RevisionInvariantsTest` green.

## Out of scope

- New invariants beyond the five already specified in §25.5 — this task extends their
  *coverage*, not the specification itself.
- Non-property (example-based) regression tests for the specific `M15.2` call sites
  (project creation, rename cascade, restore) — `M15.3.2`.

## Notes / hazards

- Keep the batch action's generated N small (2-5) and bounded — the goal is proving the
  mechanism is correct under the same kind of adversarial interleaving the existing
  single-asset generators already produce, not stress-testing arbitrarily large
  batches (that belongs in a performance/benchmark task if ever needed, not here).
- If the existing generator model is a state machine (jqwik `@StateMachine`/command
  pattern), add the batch action as a new `Command` implementation reusing the existing
  model's state representation rather than forking a parallel model just for batches.
