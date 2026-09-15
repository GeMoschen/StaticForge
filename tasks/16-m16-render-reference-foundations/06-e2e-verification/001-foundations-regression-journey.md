---
id: M16.6.1
status: todo
depends: [M16.1.1, M16.2.2, M16.3.3, M16.4.1, M16.5.1, M16.5.2]
epic: m16-render-reference-foundations
feature: e2e-verification
area: qa
---

# M16.6.1 — Foundations regression journey, benchmark, docs & spec sync

## Context

Existing journeys live in `ui/e2e/` (`m6-journeys.spec.ts`, `m15-journeys.spec.ts`). Per `M15.6.1`,
they collect, but in this environment they haven't run against a live backend without a seeded demo
user. See the memory note on running StaticForge locally (dev ports/login, the memory-only token
navigation trick). The 5,000-page benchmark fixture is the one used for §2.1 G5 (`M4`).

## Goals

- `ui/e2e/m16-journeys.spec.ts` with these journeys:
  1. **Cross-asset value:** page B has a headline, and page A's template has
     `$CMS_VALUE(page:b.headline)$`. Preview A and see B's headline. Edit B, preview A again and see
     the update. Generate INCREMENTAL and confirm A is rebuilt.
  2. **Usages + delete guard:** place media on a page and confirm it appears in the media drawer's
     usages without running generation. Remove it from the page; deleting the media now succeeds
     without force.
  3. **Channel settings:** set a channel to PRETTY + trailing slash and generate. Output is
     `about/index.html`, and the nav hrefs resolve. Run a link checker over the output that
     resolves each href against its page (`tasks/lessons.md` rule).
  4. **Include cycle:** create two section templates that include each other. Preview shows
     `SF-TPL-0135`, and generation reports it for that page only.
  5. **Validation split:** leave a required editor empty. Autosave succeeds, and generation marks the
     page `SF-GEN-0120` with the run PARTIAL.
- Run the benchmark fixture: full and incremental timing before/after `M16`, recorded in this task's
  Notes when done.
- Docs and spec sync:
  - `cms-specification.md` §5.4: column names `valid_from_revision`/`valid_to_revision`, whether `NAV`
    exists, write-on-save semantics
  - §7.1 or §21.4: reference writes are part of the revision transaction
  - §15.2: which settings are honored
  - §16.2/§16.4: the cross-asset value contract and per-type projection
  - §10.5: structural vs completeness issues, `SF-GEN-0120`
  - §21.5: the actual cache strategy
  - `docs/template-developer-guide.md` §2.1 and §3 code tables (`SF-TPL-0111`, `0130`–`0135`, `SF-GEN-0120`)
  - `docs/architecture.md` §3/§6 (`ReferenceMaterializer`, `CompiledTemplateCache`)
  - `docs/user-guide.md` usages note

## Acceptance criteria

- [ ] `m16-journeys.spec.ts` exists and collects. It passes against a live dev backend, or, if the
      environment can't run it, this is recorded explicitly with the same caveat format as
      `M15.6.1`, and each journey step is verified manually with evidence (screenshots or generated
      output listing).
- [ ] Benchmark numbers recorded, with full < 5 min and incremental < 10 s on the fixture.
- [ ] Every doc and spec section listed in Goals is updated. Grep for "deferred" in `OctlRenderer`
      and the docs returns nothing about cross-asset values.
- [ ] `./gradlew build` and `ui npm run build` green.

## Out of scope

- Fixing the pre-existing `@analogjs/vite-plugin-angular` `templateUrl` spec failures (see `M15` exit
  criteria).

## Notes / hazards

- Journey 1 needs INCREMENTAL generation to have a previous successful run. Seed a FULL run first.
- `ConcurrentWritersTest` is known to be flaky (memory note). Don't count a single failure there as
  a regression of this epic without re-running it.
