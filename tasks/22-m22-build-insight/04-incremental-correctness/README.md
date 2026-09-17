# Feature: Incremental build correctness

**Spec:** Corrects implementation drift from §18.2 (incremental plan), §18.4 (atomic
publish of a complete site) and §18.6 (incremental targets assume the rest of the site
stays published).

## Goal

An incremental run must publish the **same site** a full run at the same revision would
publish. Only the work done differs. Today it doesn't:

- `GenerationService.executeRun` hands the target writer only the re-rendered files plus
  the copied media. `FilesystemTargetWriter.stage` writes those into a fresh
  `{root}/builds/{runId}/`, and `publish` flips `current` to it. Every page that wasn't
  rebuilt disappears from the published site. `ZipTargetWriter` packs the same partial
  file set. `S3TargetWriter` diffs against the previous run's manifest but stores a
  partial manifest for the new run.
- `sitePages(snapshot, plan, channels)` builds `PostProcessContext.pages` from the plan
  entries, so `sitemap.xml` and `search-index.json` list only rebuilt pages.
- The baseline revision is `runs.findRecentSuccesses(projectId).findFirst()`. It is per
  project, not per target, and ignores whether that run was scoped (`folderPath`,
  `assetUuids`) or covered only some channels.

Without this, build insight would explain an incremental plan whose published result is
wrong.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-full-site-page-list.md](001-full-site-page-list.md) | — (verified bug; **do first**, prerequisite for `M22.1.1` fallback reasons and `M22.2.1` dry run) |

## Feature exit criteria

- [x] Incremental output (files and bytes) equals full output at the same revision for
      every target type, apart from build metadata. Proven by an integration test per
      writer.
- [x] Sitemap and search index always cover the whole site.
- [x] Baseline is per target and only advanced by runs that cover the whole site for
      the channels in question.

## Dependencies

`M4:generation` (`GenerationService`, `TargetWriter` + `FilesystemTargetWriter`,
`ZipTargetWriter`, `S3TargetWriter`, `PostProcessStage`, `SitemapPostProcessor`,
`SearchIndexPostProcessor`). No dependency on other `M22` features: this feature is
the epic's first step, and `M22.1.1`/`M22.2.1` build on its baseline rule.
