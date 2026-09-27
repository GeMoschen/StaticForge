---
id: M30.5.1
status: done
depends: [M30.4.2]
epic: m30-quality-checks-and-redirects
feature: redirect-output
area: backend
---

# M30.5.1 — Redirect formats per target: HTML stubs, `.htaccess`, `redirects.json`

## Context

`postprocess/RedirectPostProcessor` (writes `redirects.json` from `PostProcessContext.redirects()`),
`PostProcessStage` (fixed chain: pretty print → sitemap → robots → redirects → search index), `GenerationTarget.config`
(JSON; `baseUrl` read at `GenerationService:617`–`:622`), `TargetController` (create `DEVELOPER`, update
`PROJECT_ADMIN`) and its DTO validation, channel settings (`urlStrategy`, `trailingSlash`, `indexFileName`, §18.3),
`CarryForward.publication()` (site files always rewritten), `BuildManifest.Kind.SITE`, `quality/SiteIndex`
(`redirectSources` for `SF-CHK-0109`, `M30.2.1`). Epic decisions 16, 18.

## Goals

- Target config key `redirectFormats` (array of `HTML_STUB`, `HTACCESS`, `JSON`; default `["HTML_STUB"]` when absent;
  empty array = no redirect output). Validated on target create/update (`400` with the field). Exposed in the target DTO.
- **HTML stub** per active redirect at its `from_path`:
  `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh"
  content="0; url=REL"><link rel="canonical" href="ABS_OR_REL"><script>location.replace(REL + location.hash)</script>
  <title>Moved</title></head><body><a href="REL">…</a></body></html>` — `REL` is the target **relative to the stub's
  own path** (lessons 2026-09-15), `ABS` uses the target's `baseUrl` when set; every value HTML-attribute-escaped and
  the JS string JSON-escaped. External `to_path` URLs are used as-is (http/https only).
- **`.htaccess`** at the site root: a marked block `# BEGIN StaticForge redirects` … `# END StaticForge redirects`
  with `Redirect 301 "<from-url-path>" "<to-url-path-or-URL>"` per redirect. URL paths are site-root paths as visitors
  request them (`/` + path, prefixed with the path part of `baseUrl` when there is one; `index.html` suffix replaced by
  `/` when the channel uses pretty URLs with trailing slash), percent-encoded, quotes and backslashes escaped; sorted
  for stable output. If the build also has a real `.htaccess` output (e.g. a media file), the block is **appended** to it
  instead of replacing it — document this.
- **`redirects.json`**: existing shape `[{from,to}]`, extended with `channel`, `locale`, `status: 301`.
- Stubs are `SITE` outputs in the manifest, written in every build from the full active set (site files are always
  rewritten, §18.4), removed when the redirect goes (carried-build removal works through the manifest diff); they are
  added **after** sitemap and search index in the chain, so neither lists them (keep the order explicit and tested).
- A stub path that equals a real output is never written (shadowed, `M30.4.1`); assert there is no `SF-GEN-0110`
  collision from redirects.
- Fill `SiteIndex.redirectSources` so `SF-CHK-0109` works; add its fixture (see `M30.2.1` notes).
- Regenerate OpenAPI and `schema.d.ts` (target DTO).

## Acceptance criteria

- [x] Golden files for a stub (relative link from a nested path, canonical with and without `baseUrl`, a `from_path`
      with spaces and `&`), for `.htaccess` (pretty URLs, `baseUrl` with a path prefix, append to an existing
      `.htaccess`) and for `redirects.json`.
- [x] Per-target formats: two targets of one project with different `redirectFormats` get different site files.
- [x] Stub removed from the published build after its redirect is deleted (incremental and full).
- [x] Sitemap and `search-index.json` contain no stub; `SF-CHK-0109` reports a link to a stub (seam proven by a build-level test; the 0109 end-to-end fixture is added at merge — see Notes).
- [x] `./gradlew build` green.

## Out of scope

- nginx map and `_redirects` formats (not chosen by the user; the format list is an enum so they can be added later),
  status codes other than 301, wildcard rules.

## Notes / hazards

- The shipped `infra/nginx` setup serves stubs fine (they're HTML files); `.htaccess` is ignored by nginx — the target
  form should say "Apache only" next to the option.
- HTML stubs are the only format that works for ZIP targets opened locally; keep them the default.
- Implemented: `generate.RedirectFormat` (sf-domain; lenient `of`, strict `validate` → `400` with
  `field: config.redirectFormats`), `GenerationTargetView.redirectFormats` (effective list), post-processors
  `RedirectPostProcessor` (JSON), `HtaccessPostProcessor`, `HtmlStubPostProcessor` + `RedirectLinks` (URL forms);
  `PostProcessStage` order html → sitemap → robots → search index → JSON → .htaccess → stubs (`processors()`, tested).
  The relative-link algorithm moved from `GenerationRenderer` to `render.SiteLinks` (shared, unchanged).
- `SiteIndex.redirectSources` is filled through `CheckInput.redirectSources` (`RedirectSources`, asked per output set:
  before and after the hold-back) when the target writes any redirect format. The `SF-CHK-0109` rule is written by
  the links lane in parallel, so its end-to-end fixture is added by the orchestrator at merge; this task proves the
  seam with a build-level test (`RedirectOutputIntegrationTest.redirectSourcesAreTheEmittedStubPaths`: a test site rule
  sees exactly the emitted stub path, in both phases; a target without formats sees none).
- The build's own site files (sitemap, robots, search index, `redirects.json`, `.htaccess`) count as live for the
  build's redirects (a manual redirect from `sitemap.xml` is shadowed); a published manifest's SITE files (stubs) still
  don't. Of two redirects with one source path (different channels) the first in channel/locale order is written.
- A carried `.htaccess` *page* output is re-read from the base build and post-processed again, and keeps its PAGE
  manifest entry (`CarryForward.publication`: a processed file over a kept output keeps its description), so the block
  is replaced, never duplicated.
- Deviation: in `.htaccess` the *source* URL path is written decoded (quoted, `\"` escaped), not percent-encoded:
  Apache's `Redirect` matches the %-decoded request path (mod_alias docs), so an encoded source with a space would
  never match. The target is percent-encoded. Backslashes can't occur (the registry refuses them).
- Risk (needs a user decision, epic decision 18 is binding): Apache `Redirect` matches by path *prefix*; a directory
  source (`/about/` with pretty URLs) also redirects URLs below it, e.g. a live `/about/team/`. An anchored
  `RedirectMatch 301 "^/about/$" …` would avoid it. Documented in `HtaccessPostProcessor`.
- Deviation: `redirects.json` and `.htaccess` are written whenever their format is configured (an empty list / empty
  block when nothing redirects), so a host reading them always finds them; stubs only exist per redirect.
- Stubs checked in a real browser (Chromium via Playwright, `file://`): the nested and the spaces-and-`&` golden stubs
  land on their targets, the fragment kept.
