---
id: M30.1.3
status: done
depends: [M30.1.1, M30.1.2]
epic: m30-quality-checks-and-redirects
feature: check-framework
area: backend
---

# M30.1.3 — `CHECK` stage in generation: hold-back, carried facts, reference events, fallback

## Context

`GenerationService.executeRun` (`:404`–`:500`: RENDER → ASSETS → POST → WRITE, `partial` at `:487`),
`GenerationService.baselineFor` (`:377`–`:402`) and `FallbackCause`, `RenderPipeline.execute` / `incompletePages`
(`:130`), `RenderOutcome` (`pageErrors`), `GenerationRenderer` (`SF-GEN-0220` at `:897`, silent `""` for missing media
at `:466`, `OutputPathResolver.resolvePagePath` throwing at `:106` → `SF-GEN-0204`), `CarryForward` (`sitePages`,
`publication`), `BuildManifest`, `TargetWriter.writeManifest/readManifest` (filesystem, ZIP, S3 mirror), SSE
`RunEvent`. Epic decisions 5–8, 10, 11.

## Goals

- **Reference events.** During RENDER the renderer records, per output being rendered, every reference it could not
  resolve: `DELETED` (today's `SF-GEN-0220`), `UNRELEASED` (M27 `SF-GEN-0221`), `MISSING` (page or media uuid not in
  the snapshot). `MISSING` pages no longer throw: they render `""` like deleted ones, so one bad link no longer fails
  the run (`SF-GEN-0204` stays for real render failures). The existing render warnings stay as they are.
- **Stage.** New `STAGE_CHECK` "Checking output" after ASSETS, before POST. For every HTML output rendered in this run:
  parse once, extract `HtmlFacts`, run the enabled page rules. Then build the `SiteIndex` (new outputs + carried outputs
  from the base manifest + their facts from the base sidecar) and run the site rules over all of it.
- **Hold-back.** Outputs with an effective `ERROR` finding (new outputs only) are removed from the files, the manifest
  and `sitePages`, exactly as a page held back by `SF-GEN-0120` is (same code path — verify how held-back pages are kept
  out of `CarryForward.publication()` and `sitePages()` today and reuse it), with one file error `SF-GEN-0125` "Quality
  check failed: <codes>" per page → run `PARTIAL`. Then the "link to held-back page" rule runs, capped at `WARNING`
  (decision 6).
- **Warnings don't change status**: check findings never enter `warnings`/`fileErrors`; they go to
  `RunFindingStore`. `warning_count` keeps meaning render/copy warnings.
- **Sidecar.** Write `builds/{runId}.quality.json` (facts + page-local findings per HTML output, the effective config
  hash) through a new `TargetWriter.writeSidecar(runId, name, bytes)` / `readSidecar(runId, name)` for every writer,
  pruned with the build like the manifest. Carried outputs take their facts and page-local findings (re-severitied under
  the current config — only `OFF` vs not, since a config change plans FULL) from the base sidecar; findings copied that
  way are stored with `carried = true`.
- **Fallback.** `baselineFor` plans FULL with `BASE_BUILD_WITHOUT_QUALITY_FACTS` when the base build has no sidecar and
  with `QUALITY_RULES_CHANGED` when `qualityRulesChangedSince(baseline)` (`M30.1.2`). Add both to `FallbackCause`, to
  `PlanInsight`, and to the UI's cause labels (`insight.util.ts`) — the UI part is tiny, do it here.
- **SSE and plan.** Emit the `CHECK` stage with counts; the dry run (`/generations/plan`) doesn't run checks.
- **Metrics.** `sf.quality.check.duration`, `sf.quality.findings{severity,category}`.

## Acceptance criteria

- [x] Integration test with two test rules (one page, one site): findings stored with the right key and selector;
      `ERROR` holds the page back (not in output, manifest, sitemap or search index; `SF-GEN-0125`; run `PARTIAL`);
      `WARNING` only → run `SUCCESS`, `warning_count` unchanged.
- [x] With every rule `OFF` the output bytes are identical to a build with checks enabled (checks never change bytes).
- [x] A link to a page uuid missing from the snapshot: run no longer `FAILED`; a `MISSING` reference event exists for
      the linking output.
- [x] Incremental: carried facts and findings come from the base sidecar (`carried = true`); a site rule sees carried
      outputs; no sidecar → FULL with `BASE_BUILD_WITHOUT_QUALITY_FACTS`; rule config changed → FULL with
      `QUALITY_RULES_CHANGED`.
- [x] Filesystem, ZIP and S3-mirror writers write, read and prune the sidecar (writer tests).
- [ ] Benchmark on the 5,000-page fixture (`infra/scripts/README-benchmark.md`): full build with the complete M30 rule
      set within +15 % of the pre-M30 time; result recorded in the task notes. (Run it again after `M30.2.*`.)
      — open by design: the orchestrator runs the 5,000-page baseline vs M30 back to back; 500-page run below.
- [x] `./gradlew build` green.

## Out of scope

- Concrete rules (`M30.2.*`), redirects (`M30.4.*`), UI beyond the fallback-cause labels.

## Notes / hazards

- Parsing must run on the render pool, not the request thread; a parse failure of one output (jsoup is lenient, but
  guard anyway) is a `WARNING` finding `SF-CHK-0001` "Output could not be checked", never a failed run.
- Hold-back must remove *all* outputs of that page in that channel and locale (every page number of a paginated page),
  otherwise page 2 links to a missing page 1.
- Order inside `executeRun` matters for `M30.4.2` (redirect detection needs the final output set after hold-back);
  leave a clearly named seam (`CheckResult.finalOutputs()`).
- Findings are persisted in the REPORT step together with the run status; a cancelled run stores none.
- Built: `QualityCheckStage` (CHECK between ASSETS and POST; SSE `CHECK` "Checking output", then "Checked N outputs:
  e errors, w warnings[; k held back]"), `QualitySidecar` (`builds/{runId}.quality.json`, facts + page-local findings +
  config fingerprint), `TargetWriter.writeSidecar/readSidecar` (filesystem, ZIP, S3 mirror; pruned with the build,
  `StoredItem.Kind.SIDECAR` for `build-output-cleanup`), `RenderedFile.references` (`ReferenceEvent` DELETED /
  UNRELEASED / MISSING recorded by `GenerationRenderer.urlResolver`, also a deleted section template),
  `GenerationRunProbe.CHECK_OUTPUT`.
- Seam for M30.4.2: `QualityCheckStage.CheckResult.finalOutputs()` (outputs after the hold-back) is available in
  `GenerationService.executeHeld` as `check`, before POST; `check.published(outcome.files())` are the rendered files the
  run publishes.
- Deviation (fix): every page output the run planned but doesn't publish — held back by `SF-GEN-0120`, a render limit,
  a missing channel source or the checks — is now withheld from `sitemap.xml` and `search-index.json`
  (`CarryForward.withhold`). Before, `SF-GEN-0120` pages were listed there although they had no file.
- Deviation: `QUALITY_RULES_CHANGED` also fires when the base sidecar's configuration fingerprint differs from the
  current one (a rule added or changed by an application update), not only on a `qualityRules` revision.
- Carried findings take the current severity of their rule (switched-off rules drop them); they never hold back.
- A `MISSING` page/media/folder reference renders `""` without a render warning (the finding reports it); deleted and
  unreleased keep their `SF-GEN-0220`/`0221` warnings.
- Site files known to the index before POST: `search-index.json`, plus `sitemap.xml` and `robots.txt` with a `baseUrl`.
- Test infrastructure: `QualityBuildFixtures` (build a fixture project, read stored findings, sidecar and manifest),
  `QualityTestRules` (`SF-CHK-0190` missing target, `0191` after hold-back, `0192` reference events, `0390` flag).
- Benchmark (default fixture, `SF_PERF=true`, 500 pages, production rule set = `SF-CHK-0001` only, i.e. parse + facts):
  `fullMs=2492, msPerEntry=4.95, incrementalMs=1388, allChangedIncrementalMs=1515`. The 5,000-page baseline vs M30
  comparison is run by the orchestrator; rerun after `M30.2.*` with the full rule set.
