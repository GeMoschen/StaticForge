---
id: M30.5.1
status: todo
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

- [ ] Golden files for a stub (relative link from a nested path, canonical with and without `baseUrl`, a `from_path`
      with spaces and `&`), for `.htaccess` (pretty URLs, `baseUrl` with a path prefix, append to an existing
      `.htaccess`) and for `redirects.json`.
- [ ] Per-target formats: two targets of one project with different `redirectFormats` get different site files.
- [ ] Stub removed from the published build after its redirect is deleted (incremental and full).
- [ ] Sitemap and `search-index.json` contain no stub; `SF-CHK-0109` reports a link to a stub.
- [ ] `./gradlew build` green.

## Out of scope

- nginx map and `_redirects` formats (not chosen by the user; the format list is an enum so they can be added later),
  status codes other than 301, wildcard rules.

## Notes / hazards

- The shipped `infra/nginx` setup serves stubs fine (they're HTML files); `.htaccess` is ignored by nginx — the target
  form should say "Apache only" next to the option.
- HTML stubs are the only format that works for ZIP targets opened locally; keep them the default.
