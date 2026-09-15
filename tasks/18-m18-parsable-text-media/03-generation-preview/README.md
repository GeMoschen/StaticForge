# Feature: Generation and preview

**Spec:** Extends §18.2 (the ASSETS stage renders opted-in media instead of copying bytes, and
PLAN adds media entries to incremental builds) and §19.2 (preview mechanics for media).

## Goal

Make processed media produce **rendered** output wherever the site is materialized:

- **Generation.** `GenerationService.executeRun` currently runs `AssetCopyStage.copy(snapshot,
  mediaUuids(outcome, snapshot))` and writes blob bytes unchanged. After this feature,
  processed media in that set is rendered through OCTL, using the snapshot revision and the
  shared render context from the epic Notes. Media that the processed file references is
  pulled into the copy set too, transitively. An incremental build re-renders a processed
  file whenever one of its dependencies changed.
- **Preview.** `PageRenderService.urlResolver` rewrites media links to
  `/projects/{key}/media/{uuid}/share?t=…`, which `MediaController.shareBinary` serves as raw
  blob bytes. After this feature, that endpoint renders processed media at the token's
  revision.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-render-processed-media-in-generation.md](001-render-processed-media-in-generation.md) | `M18.2.1`, `M16.1.1`, `M16.2.2`, `M16.3.3`, `M17.3.1` |
| 2 | [002-preview-serves-rendered-media.md](002-preview-serves-rendered-media.md) | 1 |

## Feature exit criteria

- [ ] A full generation writes rendered bytes for processed media. Unprocessed media is still
      byte-identical to the blob.
- [ ] Media referenced only from a processed file (e.g. a font or image in CSS) is copied too.
- [ ] An incremental run re-renders a processed file when a dependency changed, and doesn't
      when nothing it depends on changed.
- [ ] Preview renders processed media at the preview revision, with links relative to the
      preview share URLs.
- [ ] Rendered SVG is sanitized after rendering, in both generation and preview.

## Dependencies

`M18.2.1` (compiler + instruction policy). `M16.1.1` (compile cache). `M16.2.2` (cross-asset
values in the snapshot and live resolvers). `M16.3.3` (revision-aware reverse reference
queries in `BuildPlanner`). `M17.3.1` (the `global:` / `$CMS_GLOBAL$` resolvers, which the
media render context must include).
