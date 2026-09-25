---
id: M30.4.2
status: todo
depends: [M30.4.1, M30.1.3]
epic: m30-quality-checks-and-redirects
feature: redirect-registry
area: backend
---

# M30.4.2 — Redirect detection on build

## Context

`GenerationService.executeRun` (`:404`–`:500`; `PostProcessContext` built at `:473`–`:476` with `redirects` hard-coded
`List.of()`), `planFor` (`:277`–`:318`, `base == null` for FULL), `CarryForward.publication()` (`:210`–`:240`,
`removedPaths`), `BuildManifest.Output`, `TargetWriter.currentRunId()/readManifest(runId)`, `RedirectService`
(`M30.4.1`), the check stage's final output set (`M30.1.3`, `CheckResult.finalOutputs()`). Epic decisions 15, 16.

## Goals

- **Previous outputs.** Every run reads the target's **current** manifest (`currentRunId` → `readManifest`) — also for
  FULL runs, which have no base — and indexes its PAGE outputs by `(asset, channel, locale, pageNumber)`. No current
  build, or a manifest written before manifests had locales, → no detection for the affected keys (log once).
- **Diff.** After hold-back (`M30.1.3`), for each PAGE output of the new build whose key exists in the previous
  manifest with a **different path**: candidate AUTO `from = old path → asset + page number`. Keys missing from the new
  build add nothing (decision 15).
- **Redirect set for this build**: persisted redirects ∪ candidates, resolved by `RedirectService.resolve` against the
  new build's outputs (`ACTIVE` ones only; shadowed, dangling and loops left out), passed to `PostProcessContext.redirects`
  as `Redirect(from, to, channel, locale)` where `to` is the target's output path in the **same channel and locale**
  (MANUAL `to_path` URLs pass through). `Redirect` gains channel/locale.
- **Persist** the candidates with `source_run_id` in the REPORT step, only when `publish` succeeded; an existing AUTO
  entry with the same `from_path` is replaced, a MANUAL one is never touched.
- `plan_summary` / run view: `redirectsAdded`, `redirectsActive` counts; the dry run reports the candidates it *would*
  add (`/generations/plan`), without persisting.
- Scoped runs detect only for outputs they rendered; carried outputs keep their paths by definition.

## Acceptance criteria

- [ ] Integration tests (filesystem target): page moved to another folder, UID change, folder rename, template
      `outputPath` change, channel `urlStrategy` change — each adds AUTO entries on the next FULL and on the next
      INCREMENTAL build; a failed or cancelled build adds none.
- [ ] A → B, then B → C: the registry holds two AUTO entries (A→asset, B→asset), both emitted to C (one hop each).
- [ ] New page published at A: entry shadowed, not emitted; unpublishing that page makes it active again.
- [ ] Localized project: moving the page in `en` only (M27 per-locale release) adds an `en` entry only.
- [ ] Paginated page moved: one entry per page number.
- [ ] `./gradlew build` green.

## Out of scope

- Writing the formats (`M30.5.1`), UI.

## Notes / hazards

- Compare against the target's current manifest, not the base build: they differ after a promote/rollback — the
  promoted build *is* what visitors see, so it is the right reference. Test a promote followed by a build.
- The URL registry's assign-once nav hrefs (`UrlRegistryEntry`) can still point at the old path after a move until the
  entry is reset (planning finding); with redirects in place those links now work — note it in the docs task, don't
  change the registry here.
- Two targets with different current builds may detect different candidates; the registry is per project, so both end up
  in it — harmless (an entry is emitted only where it resolves).
