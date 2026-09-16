# M18 — Parsable text media

**Spec:** Extends §11 (asset type Media: §11.3 payload, §11.4 upload flow, §11.5 constraints),
§16 (OCTL — a new render context that belongs to no page), §18.2 (generation stages: ASSETS
stops being a pure byte copy for opted-in media) and §19 (preview). Not part of the original
§27 roadmap. It was added the same way `M8`–`M17` were, as a post-v1 capability.

## Goal

Today every media file is opaque bytes. `MediaServiceImpl.doUpload` sniffs the MIME type with
Tika, sanitizes SVG (`SvgSanitizer`), stores a content-addressed blob, and records
`blobSha256`/`mimeType` in the payload. At generation, `AssetCopyStage.copy` writes those exact
bytes to `MediaPaths.mediaPath(uid, ext)` for every media UUID that
`GenerationService.mediaUuids` collected from page render dependencies. A stylesheet or script
therefore can't use the project's content: no `$CMS_VALUE(global:site.brandColor)$` in
`site.css`, no `$CMS_REF(media:logo)$` in a web manifest, no page URLs in a JSON config.

This milestone lets a template developer opt a **text** media file into the CMS syntax:

- A per-media `processCms` flag, offered only for text MIME types (CSS, JS, JSON, SVG,
  plain text, XML).
- In-app text editing of the file content. Each save stores a new blob and creates a
  revision, like any other media change.
- OCTL validation when the file is saved, with the same diagnostics the template IDE shows.
- At generation, the file is rendered **once per run** through OCTL instead of being
  byte-copied:
  - escaping `NONE`
  - rendered in the project's default channel
  - relative URLs computed from the media file's own output path
  - `$CMS_GLOBAL$` / `global:` values available (`M17`)
- Processed media joins the incremental plan whenever something it references changes, even
  when no page that links to it was re-rendered.
- Preview serves the rendered output, not the raw source.

Media without the flag keeps today's behaviour byte-for-byte.

## Exit criteria (epic is done when)

- [x] A text media file (CSS/JS/JSON/SVG/TXT/XML) can have `processCms` switched on/off. The
      flag is rejected (400) for any other MIME type, and flipping it creates exactly one
      revision.
- [x] A text media file's content can be edited in the media drawer. Each save creates a new
      blob and one revision, and the diff/restore of that revision works like any other media
      change.
- [x] Saving processed content whose OCTL has errors is rejected with 422 and diagnostics.
      Warnings (`$$` occurrences, unescaped `$CMS_VALUE` in JS/JSON) are returned but don't
      block the save.
- [x] Generation writes the **rendered** output of a referenced processed media file to its
      normal `assets/media/{uid}.{ext}` path. `$CMS_VALUE(global:…)$`, `$CMS_REF(page:…)$` and
      `$CMS_REF(media:…)$` resolve, with links relative to the media file's own path.
      Unprocessed media output is byte-identical to before.
- [x] Rendered SVG output is sanitized again after rendering, so injected content can't
      reintroduce script.
- [x] An incremental run after changing only a global value that a processed CSS file
      references re-renders and rewrites that CSS file, without re-rendering unrelated pages.
- [x] Preview (page preview links and the media share endpoint) serves the rendered output of
      processed media at the preview revision.
- [x] Media referenced by a processed file is copied into the build even when no page
      references it directly.
- [x] Docs (`user-guide.md`, `template-developer-guide.md`) describe the flag, the render
      context and the `$$` rule. The E2E journey passes.
- [x] `./gradlew build` and `ui` `npm run build` are green. `npm test` has no new failures
      beyond the known `templateUrl` spec-runner issue.
  - *Verified 2026-09-16:* `./gradlew build` green, 601 backend tests (510 at M17), 0 failures, 1 skipped (benchmark; run separately: 500 pages full 2.1 s, incremental 0.12 s). `ng build` green once the media route was made lazy (initial bundle 841 kB). vitest: 19 failing files, all the known `templateUrl` component specs; the new `text-media.util.spec.ts` (10) passes. Live Playwright: `m18-journeys` 2/2, `m16` 5/5, `m17` 4/4.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [domain](01-domain/README.md) | backend | — |
| 2 | [compile-on-save](02-compile-on-save/README.md) | backend | 1, `M16.3.1` |
| 3 | [generation-preview](03-generation-preview/README.md) | backend | 2, `M16.1.1`, `M16.2.2`, `M16.3.3`, `M17.3.1` |
| 4 | [ui](04-ui/README.md) | frontend | 1, 2, 3 (`?rendered=true`) |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 3, 4 |

## Dependencies

- `M16` (render & reference foundations):
  - `M16.1.1` compile cache: processed media is compiled every run, so it must not bypass the cache.
  - `M16.2.*` cross-asset `$CMS_VALUE`: without it, `global:`/`page:` values render empty.
  - `M16.3.1`/`M16.3.3`: references written on save and revision-aware reference queries,
    which the incremental planner walks.
- `M17.3.1`: the `global:` prefix and `$CMS_GLOBAL$` scope, the main use case for this epic.
- Existing: `MediaServiceImpl`/`MediaController`, `MediaPaths`, `AssetCopyStage`,
  `GenerationService`, `BuildPlanner`, `GenerationRenderer`, `PageRenderService`,
  `media-detail-drawer.component.ts`.

## Notes

- **Opt-in is the literal-`$` guard.** The OCTL lexer treats `$$` as an escaped `$` and
  `$CMS_…$` as instructions. Plenty of real JavaScript contains `$$` (DevTools helpers,
  minified bundles) or strings starting with `$CMS_`. Parsing every text file automatically
  would silently change existing output, which is why the user chose a per-file flag.
  Switching the flag on runs a scan and returns warnings for every `$$` and unparseable
  `$CMS_` occurrence, so the author sees the impact before the next build.
- **Blobs stay content-addressed source.** The blob behind `payload.blobSha256` is the
  *source* text, and it must never be overwritten with rendered bytes. Rendered output depends
  on the snapshot revision and on other assets, so it is produced per generation run (and per
  preview request) and written only to the build output. It is never stored in `BlobStore`
  under the source SHA.
- **One render context per file, not per channel.** Media paths are channel-independent
  (`MediaPaths` has no channel segment), so a processed file renders once:
  - in the project's default channel (`OutputChannel.defaultChannel`)
  - with escaping `NONE`, whatever that channel's `defaultEscaping` is
  - `$CMS_META(channel)$` returns the default channel key
  - `$CMS_REF(page:…)$` resolves to the default channel's page path

  Per-channel rendering of media is out of scope for this epic.
- **Escaping `NONE` is a deliberate trade-off.** It is correct for CSS and plain text, but in
  JS/JSON an editor-typed value can break out of a string literal. Authors use `| js` /
  `| json` explicitly, and the compiler warns when a `$CMS_VALUE` in a JS/JSON file has no
  escaping filter. It does not block the save.
- **Tika detection** decides whether a file counts as "text". Some `.js`/`.json` uploads come
  back as `text/plain` or `application/octet-stream`, depending on content. The allow-list and
  the `MediaPaths.extensionFor` mapping (`application/json` currently falls through to `bin`)
  must be checked against real Tika results, not assumed.
- `MediaServiceImpl.replace` rebuilds the payload through `buildPayload(...)` and copies only
  `altText`/`caption`/`copyright`/`focalPoint` from the old payload. A replace would silently
  drop `processCms` unless it is carried over explicitly. This is covered in `M18.1.1`.
- Localized processed media (a CSS per locale) is not planned. If `M24` wants it, it adds it.
