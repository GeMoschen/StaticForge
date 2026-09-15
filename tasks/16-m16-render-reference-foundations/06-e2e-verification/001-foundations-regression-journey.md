---
id: M16.6.1
status: in-progress
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

- [x] `m16-journeys.spec.ts` exists and collects. It passes against a live dev backend, or, if the
      environment can't run it, this is recorded explicitly with the same caveat format as
      `M15.6.1`, and each journey step is verified manually with evidence (screenshots or generated
      output listing).
- [x] Benchmark numbers recorded, with full < 5 min and incremental < 10 s on the fixture.
- [ ] Every doc and spec section listed in Goals is updated. Grep for "deferred" in `OctlRenderer`
      and the docs returns nothing about cross-asset values. **Open:** owned by the docs agent on a separate
      branch; `git log m16-foundations` shows no docs/spec commit merged yet (`OctlRenderer` itself has no
      "deferred" left).
- [x] `./gradlew build` and `ui npm run build` green.

## Out of scope

- Fixing the pre-existing `@analogjs/vite-plugin-angular` `templateUrl` spec failures (see `M15` exit
  criteria).

## Notes / hazards

- Journey 1 needs INCREMENTAL generation to have a previous successful run. Seed a FULL run first.
- `ConcurrentWritersTest` is known to be flaky (memory note). Don't count a single failure there as
  a regression of this epic without re-running it.

### Implementation notes

**Status `in-progress`:** every criterion except the docs/spec sync is met; that one belongs to the docs agent and
is not merged into `m16-foundations` yet. The docs agent documented the pre-fix behaviour of the two bugs below
(run FAILED on an include cycle; unpinned runs failing with `SF-TPL-0110` on a deleted target) and needs to switch
to the final behaviour described here.

**Journeys (`ui/e2e/m16-journeys.spec.ts`) — run live, 5/5 passed** (once serial, once with 2 workers) against
`SPRING_PROFILES_ACTIVE=dev ./gradlew :server:sf-app:bootRun` (H2, `Admin`/`Admin`, port 8081, `SF_OUTPUT_ROOT` in a
scratch dir) and `ng serve --port 4300`. The file is self-seeding (every journey creates its own project and assets
through the REST API), gated on `SF_RUN_E2E` like the other journey files, logs in through the real form and
navigates in-app (memory-only token). `npx playwright test e2e/m16-journeys.spec.ts --list` → 5 tests. Evidence:
Playwright assertions on the live UI, API and generated output, plus one screenshot per journey in the run's output
directory.
1. **Cross-asset value — pass.** B's headline shows in A's editor preview iframe; after editing B, *Refresh* shows
   the new value; FULL then INCREMENTAL: A's file in the incremental build carries B's new headline, and the
   incremental run wrote fewer files than the full one.
2. **Usages + delete guard — pass.** With no generation run in the project, the media drawer lists the page under
   "Referenced by" and a plain `DELETE` returns 409; after removing the media from the page the drawer says "Not
   referenced by any asset.", and the drawer's Delete sends `DELETE` without `force` → 2xx, media gone.
3. **Channel settings — pass.** PRETTY + trailing slash + `indexUid=home` set in the channels form; the FULL run
   writes exactly `about/index.html`, `index.html`, `pf/deep/index.html`, `pf/p2/index.html`; root hrefs include `./`,
   `about/`, `pf/p2/`, nested hrefs `../../`, `../../about/`, `../p2/`; the link checker (each href resolved against
   its own page, directory hrefs must contain `index.html`, per `tasks/lessons.md`) checked ≥ 10 links, 0 broken.
4. **Include cycle — pass after two fixes (below).** Preview API → `422 SF-TPL-0135`; the editor preview shows
   `SF-TPL-0135` and `cycle_a → cycle_b → cycle_a`; the run is `PARTIAL` with exactly one error
   `{code: SF-TPL-0135, count: 1, messages: ["Page 'cyclic' (html): Include cycle: cycle_a → cycle_b → cycle_a"]}`
   and only `healthy.html` in the build.
5. **Validation split — pass.** Typing into the optional editor autosaves (`PATCH` 200 carrying a
   `content.title` / `required` / `COMPLETENESS` issue, status "Saved"); the run is `PARTIAL` with exactly one
   `SF-GEN-0120` naming `content.title`; `complete.html` is published, `incomplete.html` held back.

**Bugs found and fixed**
- **An include cycle failed the whole run (backend).** A `RenderLimitException` went into `RenderOutcome.errors`, so
  `GenerationService` marked the run FAILED and published nothing, and the diagnostic did not name the page.
  `RenderPipeline.renderEntry` now reports it in `pageErrors` (like `SF-GEN-0120`) with a page-named message. The
  error-class split (page-scoped: `SF-TPL-0130`–`0135`, `SF-GEN-0203`, `SF-GEN-0205`; run-level: VALIDATE,
  `SF-GEN-0110`, `SF-GEN-0204`, `SF-GEN-0206`) is documented in `M16.5.1`'s notes. Tests:
  `RenderPipelineRenderLimitsTest` (updated, plus `oversizedFileHoldsBackOnlyThatPageWith0203`),
  `IncludeCycleGenerationIntegrationTest` (new).
- **The preview frame swallowed render errors (UI).** `SfPreviewFrameComponent` set an empty document on any preview
  error, so the 422 `SF-TPL-0135` problem showed as a blank frame. It now renders the problem (code, title, detail,
  HTML-escaped) through `preview-error.ts`. Test: `preview-error.spec.ts` (vitest, 5; a plain-TS spec, so it runs
  locally despite the `templateUrl` runner issue).
- **Unpinned runs did not see soft-deleted targets (backend, reported by the coordinator/docs agent).** See
  `M16.2.2`'s notes: an unpinned snapshot is now the snapshot pinned at the head revision (deleted versions included,
  consumers audited); `$CMS_REF`, `$CMS_INCLUDE` and body/catalog sections pointing at deleted targets render empty
  with the spec §16.4 warning `SF-GEN-0220` (new constant `GenerationDiagnosticCodes.GEN_DELETED_REFERENCE`); values
  keep `SF-TPL-0112`. Fixed on the way: the unpinned snapshot revision was the max `validFromRevision` of *live*
  versions, so a delete (or channel-change) revision was never the run's revision. Test:
  `CrossAssetValueIntegrationTest.unpinnedRunsTreatSoftDeletedTargetsLikeAPinnedRun` (verified failing on the old
  `findCurrentSnapshot` path).

**Benchmark (`GenerationBenchmark`, `SF_PERF=true SF_PERF_PAGES=5000`, `-Pfrontend.skip=true`).** One page template,
5,000 pages created through `AssetService`, a FULL run, one page edited, an INCREMENTAL run. `master` (`ec02b2f`) was
built in a temporary `git worktree` in the scratchpad (removed afterwards). Runs alternated m16 / master on the same
machine with no app server running.

| Run | m16-foundations full | m16 incremental | master full | master incremental |
|---|---|---|---|---|
| 1 | 15.1 s | 1.05 s | 45.5 s | 0.51 s |
| 2 | 10.5 s | 1.28 s | 7.0 s | 0.37 s |
| 3 | 9.6 s | 0.80 s | 8.8 s | 0.38 s |
| **median** | **10.5 s** | **1.05 s** | **8.8 s** | **0.38 s** |

Every run wrote 5,003 files (full) and 4 files (incremental) on both branches. §2.1 G5 holds on both (full ≪ 5 min,
incremental ≪ 10 s). The machine is shared and noisy (master's first full run took 45 s), so the full-build difference
is within noise. The incremental run is consistently ~0.4–0.9 s slower on m16. Likely cause (not profiled): the
revision-aware `BuildPlanner` loads the reference index twice per plan (`findValidAtByProject` at the snapshot and the
last-success revision, ~5,000 `TEMPLATE` rows each). Acceptable against G5; worth a look if `M22` grows the planner.

**Build:** `./gradlew build --offline` green — 457 tests (sf-common 3, sf-template 60, sf-domain 117, sf-generate 50,
sf-api 15, sf-app 212, with the perf-gated benchmark skipped). `ui npm run build` green (pre-existing SCSS budget
warnings only).

**Caveats / observations (not changed)**
- The Liquibase cleanup changeset (`015`) is proven on H2 only; there is no PostgreSQL here.
- Angular sanitizes `iframe[srcdoc]` as HTML (`SecurityContext.HTML`), which strips `<style>` and `<script>` from
  every preview document: the rendered page's own CSS, the preview highlight script and the error document's styling.
  Journey 4's screenshot shows the error text unstyled. This is pre-existing and outside M16; it needs a deliberate
  `bypassSecurityTrustHtml` decision for the sandboxed frame.
- `$CMS_REF` to a *missing* target still fails VALIDATE with `SF-TPL-0110` (spec §16.4); only *soft-deleted* targets
  degrade to `SF-GEN-0220`.
- The older journey files (m3–m15) still use `input[name="username"]` and deep `page.goto` links, which match neither
  the current login form nor the memory-only token. Not touched here; noted in `ui/e2e/README.md`.
