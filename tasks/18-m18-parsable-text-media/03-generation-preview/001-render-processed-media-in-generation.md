---
id: M18.3.1
status: todo
depends: [M18.2.1, M16.1.1, M16.2.2, M16.3.3, M17.3.1]
epic: m18-parsable-text-media
feature: generation-preview
area: backend
---

# M18.3.1 — Render processed media during generation + incremental planning

## Context

`GenerationService.executeRun` runs these stages:
- `renderPipeline.execute(snapshot, plan, …)`
- `assetCopyStage.copy(snapshot, mediaUuids(outcome, snapshot))`, where `mediaUuids` keeps the
  MEDIA-typed UUIDs from each `RenderedFile.dependencies()`
- post-process, `materializeReferences`, `writer.stage(runId, allFiles)`

`AssetCopyStage.copy` reads `payload.blobSha256` from the snapshot, writes the bytes to
`MediaPaths.mediaPath(uid, MediaPaths.extensionFor(mime))`, and writes variants alongside.

`BuildPlanner.plan` returns `BuildPlan(incremental, revision, entries, changedAssets)`. Its
entries are `PlanEntry(pageUuid, channel, outputPath)`, so pages only. `affectedPages` does a
BFS from changed assets over reverse `asset_reference` edges plus page→template edges. Link
resolution for page renders is `GenerationRenderer.urlResolver(channel, pagePath)` →
`relativeUrl(pagePath, sitePath)`.

## Goals

- **Media render in the ASSETS stage.** For each media UUID in the copy set whose snapshot
  payload has `processCms=true` and an allow-listed text MIME type:
  - Read the source blob and decode it as UTF-8.
  - Compile it through `M18.2.1`'s `TextMediaCompiler`, using the `M16.1.1` compile cache
    keyed on the blob SHA plus the default channel.
  - Render it with a `RenderContext` built from:
    - **escaping `NONE`**
    - channel = the project's default channel key
    - `meta`: `uid`, `uuid`, `displayName`, `path` (the media output path), `revision`,
      `channel`, `projectKey`, `mimeType`
    - `urlResolver`: the same resolver pages use, with `pagePath` = the media file's own
      output path, so `url(../fonts/x.woff2)`-style relative links come out right
    - `M16.2` cross-asset value resolver
    - `M17.3.1` global resolver
    - no `blockResolver` for bodies/includes, which the compile-time policy forbids anyway;
      `nav:` iteration in `$CMS_FOR` still needs `resolveNavigationChildren`
  - Write the rendered UTF-8 bytes to the **same** `MediaPaths.mediaPath` the copy would have
    used, so every existing `$CMS_REF(media:…)$` link stays valid.
  - For `image/svg+xml`, run `SvgSanitizer` on the rendered output before writing it.
  - Keep the split between copy and render in a small collaborator (e.g. `MediaRenderStage`
    used by `AssetCopyStage`) rather than bloating `AssetCopyStage` with template logic.
    Preview (`M18.3.2`) must reuse the same render logic from `sf-domain`.
- **Transitive copy set.** Render dependencies of a processed media file that are themselves
  MEDIA join the copy set, and are themselves rendered if processed. Examples: an image in a
  CSS `url()`, a font, a processed `vars.css` referenced from `main.css` via
  `$CMS_REF(media:vars)$`. Iterate to a fixed point with a visited set, so a cycle between
  two processed files (A refs B, B refs A) terminates. `$CMS_REF` only produces a URL, so
  cycles are legal.
- **Render failures.** An OCTL render error in processed media fails that one output file,
  the same way `RenderPipeline.renderEntry` fails a page on `RenderLimitException`. The
  diagnostic names the media UID and ends up in the run's diagnostics JSON. Decide explicitly
  whether that makes the run FAILED or PARTIAL. Recommendation: PARTIAL, with the previous
  file content **not** substituted. Record the decision in the Review of this task.
- **Incremental planning.** Processed media output can change without any page changing,
  e.g. only a global value changed. Extend the plan with media entries:
  - `BuildPlan` gains a set of processed-media UUIDs to (re)render. `PlanEntry` stays
    page-only, because `M21`/`M22` change `PlanEntry` and must not collide with this.
  - In `affectedPages`' BFS, a reached MEDIA asset with `processCms=true` is added to that
    set, whether it was changed itself or reached through a reverse edge from a changed
    dependency. The BFS keeps walking reverse edges *from* that media so pages linking to it
    are handled as today.
  - A full build renders every processed media file in the copy set.
  - An incremental build renders the planned media entries even when none of the re-rendered
    pages references them in this run.
- **Dependency recording.** A processed media file's render dependencies feed
  `materializeReferences`, which after `M16.3.3` only covers what isn't already written at
  save time. The planner walks the save-time rows from `M18.2.1`, so this step is about not
  *duplicating* rows. Verify there are no duplicates.

## Acceptance criteria

- [ ] Golden-style integration test: global set `site` with `brandColor=#c00`, processed
      `main.css` containing `a{color:$CMS_VALUE(global:site.brandColor)$}` and
      `background:url($CMS_REF(media:bg)$)`, and a page linking `$CMS_REF(media:main)$`. A full
      generation writes `assets/media/main.css` with `a{color:#c00}` and
      `background:url(bg.png)`, a correct relative path next to the CSS, and copies `bg.png`.
- [ ] The same project with `processCms=false` writes `main.css` byte-identical to the blob.
- [ ] A processed JSON that uses `$CMS_REF(page:about)$` resolves to the default channel's
      page path, relative to `assets/media/`.
- [ ] Two processed CSS files that reference each other both render, and the run terminates.
- [ ] A processed SVG whose global value contains `<script>` produces sanitized output.
- [ ] Incremental: after a successful run, changing only `site.brandColor` produces a plan
      with `main.css` in the media set and **zero** page entries, unless some page depends on
      the global itself. The run output contains the re-rendered CSS.
- [ ] Incremental: changing an unrelated page does not re-render `main.css`.
- [ ] A render error in processed media shows up in run diagnostics with the media UID and the
      agreed run status.
- [ ] Existing generation tests (`GenerationIntegrationTest`, navigation/URL-registry
      journeys, the 5,000-page benchmark if it runs in CI) are unaffected. The benchmark
      stays within the §18.6 targets.
- [ ] `./gradlew :server:sf-generate:test :server:sf-domain:test` is green.

## Out of scope

- Per-channel or per-locale rendering of media.
- Minification or fingerprinting of rendered assets (that's feature #19 from the ideas list,
  not planned here).
- Preview (`M18.3.2`).

## Notes / hazards

- **Never write rendered bytes into `BlobStore`.** The source blob is revision-pinned,
  content-addressed history. Rendered output is derived per run. Caching rendered output is
  fine only in memory, keyed by (source SHA, snapshot revision).
- **What an incremental build actually publishes.** Before implementing, read how
  `writer.stage(runId, allFiles)`/`publish` treat an incremental run. The current code stages
  only the files produced in this run into `builds/{runId}` and flips `current`, which looks
  like it drops unchanged files. If so, that's a pre-existing gap owned by `M22.4.1`
  (incremental correctness), not this task. Don't paper over it here, but make sure the media
  entries still reach whatever carry-forward mechanism exists.
- `GenerationRenderer.relativeUrl` treats `pagePath` as a file path and computes links
  relative to its directory. Passing `assets/media/main.css` gives links relative to
  `assets/media/`, which is correct for CSS `url()` resolution. Browsers resolve JS `fetch`
  URLs against the *document*, not the script, so a JS file needing page URLs must use
  root-relative or absolute URLs. Document this in `M18.5.1`. Don't try to "fix" it in the
  resolver: the lessons file records that links are relative to the current output file.
- Thread safety: rendering runs on virtual threads. The copy set is computed before the
  parallel part, and the fixed-point iteration must not mutate shared sets concurrently.
