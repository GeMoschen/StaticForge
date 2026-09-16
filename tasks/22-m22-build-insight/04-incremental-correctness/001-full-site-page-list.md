---
id: M22.4.1
status: todo
depends: []
epic: m22-build-insight
feature: incremental-correctness
area: backend
---

# M22.4.1 — Incremental runs publish the complete site (page list, carry-forward, per-target baseline)

## Context

In `server/sf-generate/src/main/java/com/acme/staticforge/generate/GenerationService.java`:

- `executeRun` (around lines 270–322):
  - Baseline: `lastRevision = runs.findRecentSuccesses(projectId).stream().findFirst()`.
  - Render: `renderPipeline.execute(snapshot, plan, …)` renders only plan entries.
  - Assets: `assetCopyStage.copy(snapshot, mediaUuids(outcome, snapshot))` copies only
    media referenced by rendered files.
  - Post-process: `PostProcessContext(…, sitePages(snapshot, plan, channels))`.
  - Write: `writer.stage(runId, allFiles); writer.publish(runId)`.
- `sitePages` builds one `SitePage(uid, path, channel, title)` per plan entry.

In `generate/target/`:

- `FilesystemTargetWriter.stage` writes the given files into `{root}/builds/{runId}/`;
  `publish` flips `current` and prunes.
- `ZipTargetWriter` archives the given files.
- `S3TargetWriter` fingerprints staged files and compares them with the previous run's
  manifest (`loadManifest(TargetIo.readRunId(current()))`).

Result: after an incremental run the published site holds only the rebuilt pages, and
sitemap/search index list only those pages.

## Goals

- **Full site page list:**
  - Post-processing receives `SitePage`s for **every** page × channel of the snapshot
    (paths from the same `OutputPathResolver`), in both full and incremental runs.
  - Build the list without rendering; titles come from the snapshot.
  - `SearchIndexPostProcessor` needs rendered text. For pages not re-rendered, take the
    previous build's entry for that page (read the previous `search-index.json` from the
    target's current build, or store the extracted text per page). Choose the simpler
    correct option and note the choice here.
- **Carry forward unchanged output:**
  - Incremental runs stage the previous successful build of **the same target**, then
    overlay the rebuilt files, then remove outputs of pages deleted or moved since the
    baseline (old output paths come from the baseline snapshot's resolver, or from the
    previous run's stored plan entries/manifest).
  - Add a writer-level operation: `TargetWriter.stageIncremental(runId, baseRunId, files, removedPaths)`,
    or have `GenerationService` assemble the full file set from the previous build.
    Pick the design that keeps atomic publish (ADR-0005) intact for each writer and
    explain why in the PR.
  - Filesystem: copy/hard-link the base build then overlay.
  - ZIP: rewrite the archive from base + overlay.
  - S3: the manifest for the new run must be complete (base manifest + overlay −
    removed).
- **Per-target, coverage-aware baseline:**
  - The baseline is the newest SUCCESS/PARTIAL run for the **same target** whose
    coverage is complete: no `folderPath`/`assetUuids` scope, and channels ⊇ the
    requested channels.
  - Record coverage in `plan_summary` (`M22.1.2`), or derive it from the run's request
    fields.
  - With no such run: plan FULL and record why as a simple fallback cause
    (`NO_COMPLETE_BUILD_FOR_TARGET`, `BASE_BUILD_MISSING`) on the `BuildPlan`.
    `M22.1.1` maps this cause onto the `INCREMENTAL_FALLBACK_FULL` root kind.
  - Extract the baseline rule into one method here (e.g.
    `GenerationService.baselineFor(project, target, request)`). `M22.2.1` reuses it for
    the dry run, so the dry run can never use a different baseline.
  - Promote (`POST /{runId}/promote`) changes what is current. The baseline follows
    "current build for the target" semantics (the promoted run's revision), not "newest
    successful run". Document that and test it.
- **Tests** (integration, H2 + filesystem temp dir):
  - Full run at rev A; edit one page; incremental run at rev B. The published directory
    equals a fresh full run at rev B, byte-for-byte except build metadata.
  - Same for ZIP (archive entry set + contents) and S3 (mirror directory/manifest).
  - Delete a page between runs: its output is gone after incremental.
  - Rename/move a page: old path removed, new path present.
  - Sitemap and search index after incremental list every page.
  - Baseline: a success on target A does not make target B incremental; a scoped run
    does not advance the baseline; after promote, the baseline is the promoted run.

## Acceptance criteria

- [ ] Incremental output equals full output at the same revision for FILESYSTEM, ZIP
      and S3 writers (integration tests).
- [ ] Deleted/moved pages don't leave stale files after an incremental run.
- [ ] `sitemap.xml` and `search-index.json` are complete after incremental runs.
- [ ] Baseline is per target, coverage-aware and promote-aware; dry run and real run use
      the same rule.
- [ ] §18.6 incremental target still met on the 5,000-page benchmark (carry-forward
      cost measured and noted here). If filesystem copy is too slow, use hard links or
      a reflink-friendly copy, not a skipped correctness step.
- [ ] `docs/adrs/0005-generation-atomic-publish.md` gains a note on incremental staging;
      spec §18.2/§18.4 wording updated if the design adds a writer operation.
- [ ] `./gradlew build` green.

## Out of scope

- Rendering unchanged pages "just in case". Carry-forward is the mechanism.
- Cross-target copying (building target B from target A's output).
- Cleaning up legacy builds (already handled by `LegacyOutputCleanup`).

## Notes / hazards

- **This is a verified bug and a prerequisite for the rest of the epic.** It has no
  dependencies and should be done first: `M22.1.1` builds its fallback root kind on the
  baseline rule from here, and `M22.2.1` depends on this task. The reason and dry-run
  work must not ship on top of a publish that silently drops pages, where the plan
  would look correct and the site would be broken. The skeleton named only "incremental
  post-processing uses full site page list". Carry-forward and the per-target baseline
  are included because the page-list fix alone still publishes an incomplete site.
  Flag this scope in the PR description.
- Sequencing inside `GenerationService`: this task and `M22.1.2`/`M22.2.1` all edit
  `executeRun`. This task goes first, the others rebase onto it, and there is one owner
  at a time.
- Retention: `FilesystemTargetWriter.prune` keeps the last *N* builds. The base build
  for an incremental run must not be pruned between reading and copying. Copy before
  `publish()` prunes, and handle a missing base build by falling back to FULL with an
  explicit reason instead of failing.
- Output path changes caused by channel settings (`M16.4.1`) or template `outputPath`
  edits move many files at once. The removed-paths computation must compare full old
  vs new path sets, not only paths of changed pages.
- Windows dev environments: hard links work on NTFS, but a symlinked `current` is not
  used there (marker file). Test on the platform the CI runs on, and note what the
  local Windows run covered.
