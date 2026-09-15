---
id: M18.3.2
status: todo
depends: [M18.3.1]
epic: m18-parsable-text-media
feature: generation-preview
area: backend
---

# M18.3.2 — Preview and share endpoint serve rendered processed media

## Context

In preview, `PageRenderService.urlResolver` rewrites media links to
`{base}/projects/{key}/media/{uuid}/share?t={previewTokenService.issueMediaShareToken(...)}`.
`MediaController.shareBinary` (`GET /media/{uuid}/share?t=`, permitAll, token-checked) returns
the raw blob bytes from `MediaServiceImpl.binary`, and non-renderable types are sent with
`Content-Disposition: attachment`. The authenticated `GET /media/{uuid}/binary` serves the
media drawer and the library. With no rendering in this path, previewing a page whose
stylesheet is a processed CSS file loads the unrendered `$CMS_…$` source.

## Goals

- `shareBinary` renders processed media before responding:
  - Uses the revision carried by (or derivable from) the share token, since preview is
    revision-pinned. It does not use "now".
  - Reuses `M18.3.1`'s render logic from `sf-domain`, with a **live** resolver set: the
    `M16.2.2` live implementation, globals and navigation lookup.
  - Media links inside the rendered output go through the same preview share-URL rewriting
    `PageRenderService.urlResolver` applies to pages, so a font referenced by a processed CSS
    loads in preview too. Each rewritten link carries its own media share token.
  - For SVG, runs `SvgSanitizer` on the rendered output.
  - Serves the stored MIME type, with `Cache-Control: no-store`. The output depends on other
    assets, so the blob-SHA ETag no longer identifies it.
- Keep `GET /media/{uuid}/binary` returning the **source** bytes, because the media drawer's
  text editor and downloads need the source. Add an explicit `?rendered=true` (EDITOR) so the
  drawer can show "rendered output" (`M18.4.1`).
- A render error in preview returns the source with a response header carrying the diagnostic
  summary (e.g. `X-SF-Render-Error`), not a 500, so a broken stylesheet doesn't blank the whole
  preview. For `?rendered=true`, return 422 with diagnostics.

## Acceptance criteria

- [ ] Previewing a page that links a processed CSS file loads rendered CSS: the global value
      is substituted, and the `url()` points at a working share URL.
- [ ] Preview at an older revision (time travel) renders the CSS using that revision's global
      values.
- [ ] `GET /media/{uuid}/binary` still returns the source. `?rendered=true` returns the
      rendered output for EDITOR and 403 for VIEWER, unless VIEWER is judged acceptable
      (decide and document).
- [ ] Unprocessed media responses (bytes, headers, `Content-Disposition`) are unchanged.
- [ ] A share token for media A can't be used to render media B: token scope is checked
      exactly as today.
- [ ] A render error in preview returns the source plus the error header, and the drawer
      endpoint returns 422 with diagnostics.
- [ ] Integration tests for all of the above. `./gradlew :server:sf-api:test :server:sf-domain:test` is green.

## Out of scope

- Caching rendered preview output across requests.
- Changing how preview share tokens are issued, beyond what's needed to carry the revision.

## Notes / hazards

- Check whether `issueMediaShareToken` already encodes a revision. If not, adding one is part
  of this task. Keep old tokens valid (no revision = current), because preview links may be
  open while a deploy happens.
- The preview base URL used for rewriting inside media must be the same one the page preview
  used, or links break behind a reverse proxy. Pass it through the token or request rather
  than recomputing it.
- Rendering on every share request can be expensive for large pages with many stylesheets.
  Use the compile cache. If profiling shows a problem, add an in-memory cache keyed by
  (media uuid, revision). Rendered output must not outlive the revision it was rendered for.
