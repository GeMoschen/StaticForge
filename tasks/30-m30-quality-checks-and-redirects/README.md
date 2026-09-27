# M30 — Quality checks and redirects (build-time link, SEO and accessibility checks; automatic redirects)

**Spec:** Extends §15.2 (channel output settings), §16.4 (references to missing targets), §18.2 (stages: new
`CHECK` stage, POST redirects), §18.4 (targets: `redirectFormats`, build manifests and sidecars), §18.5 (run record:
findings), §19 (preview: draft checks), §20.2 (REST catalogue), §24 (editor Issues panel, settings tabs, run report),
§26.3 (SSRF: unchanged, no network access). Not part of the original §27 roadmap — inserted the same way `M8`–`M29`
were.

## Goal

Today a build tells you about template errors and incomplete content, but nothing about the output it wrote: a link to
a page that no longer exists renders silently (or as `""` with a warning that names the target, not the page that
links to it), nobody notices a page without a `<title>`, an image without `alt` or a heading jump, and when a page
moves or is renamed its old URL simply 404s — `redirects.json` exists but is always empty.

This milestone delivers:

- **Build-time checks** over every rendered HTML output, parsed with jsoup: **links** (internal only: missing pages
  and media, links to held-back, unreleased or deleted pages, links into another channel, missing `#anchors`, empty
  hrefs, links that only reach a redirect), **SEO** (title, meta description, duplicates across the build, `h1`,
  `lang`, `hreflang`, canonical, `noIndex`) and **accessibility** (`alt`, empty link/button text, heading order,
  duplicate ids, unlabeled form controls, untitled iframes, missing `lang`).
- **Per-project rule configuration**: each rule off / warning / error (default warning). Warnings are reported only;
  an error holds the offending page back, exactly like incomplete content (`SF-GEN-0120`).
- **Findings per run**, stored and browsable in the run details (counts, filters, jump to the page).
- **Issues while editing**: the page editor gets an Issues panel with the page's completeness findings (already
  computed, never shown) and the checks run on the draft preview render.
- **Automatic redirects**: every build compares each output (asset, channel, locale, page number) with the target's
  current build; a changed path adds old → new to a persistent per-project **redirect registry**. Manual redirects
  can be added, edited and deleted in a Redirects tab; unpublishing or deleting a page offers "Redirect old URL to…".
- **Redirect output per target**: HTML stub pages (meta refresh + canonical + JS fallback), Apache `.htaccess`
  (anchored `RedirectMatch 301`) and the existing `redirects.json`.

## Findings from planning (2026-09-25)

1. **No HTML parser on the classpath.** `gradle/libs.versions.toml` has Tika core, Lucene, Jackson and
   metadata-extractor; `SearchIndexPostProcessor.extractText` strips tags with a regex.
2. **Pipeline shape.** `GenerationService.executeRun` (`:404`–`:500`) runs SNAPSHOT → PLAN → VALIDATE → RENDER →
   ASSETS → POST → WRITE → REPORT. Rendered bytes exist only for outputs of *this* run (`RenderOutcome.files()`,
   `AssetCopyResult.files()`); carried pages of an incremental/scoped run have no bytes, only the base build's search
   text (`CarryForward.carriedText`). Any status becomes `PARTIAL` as soon as `warnings` or `fileErrors` is non-empty
   (`:487`) — so check warnings must **not** go into that list.
3. **Held-back pages.** `RenderPipeline.incompletePages` (`:130`) holds back pages with ERROR completeness findings
   (`SF-GEN-0120`), which end up in `outcome.pageErrors()` → `fileErrors` → `PARTIAL`. This is the mechanism error-level
   check findings reuse.
4. **Diagnostics have no location.** `Diagnostic(Severity ERROR|WARNING, code, message, line, column)` has no page,
   channel or output path; `SF-GEN-0220` ("reference to a deleted asset", `GenerationRenderer:897`) names the target uid,
   not the page that links to it. A link to a page uuid missing from the snapshot throws in
   `OutputPathResolver.resolvePagePath` (`:106`) → `SF-GEN-0204` → the whole run `FAILED`; a missing media uuid renders
   `""` silently (`GenerationRenderer:466`).
5. **Redirects are a stub.** `RedirectPostProcessor` writes `redirects.json` (`[{from,to}]`) from
   `PostProcessContext.redirects()`, which `GenerationService:475` always passes as `List.of()`. `PostProcessStage`
   is a fixed chain (pretty print, sitemap, robots, redirects, search index); nothing is configurable per channel or
   target.
6. **Path history exists only in manifests.** `BuildManifest.Output(path, kind PAGE|MEDIA|SITE, asset, channel,
   pageNumber, locale, dependencies)` per build (`builds/{runId}.manifest.json`, pruned with the build,
   `sf.generate.keep-builds`). `CarryForward.publication()` computes `removedPaths` only when a base build exists — a
   FULL run has `base == null` (`GenerationService:290`–`:313`), so nothing today compares a full build with what the
   target served before. The URL registry (`UrlRegistryEntry`) is assign-once nav hrefs, not revisioned and without
   history.
7. **SEO data in the payload is unused.** The page payload carries `nav.noIndex` and `meta{description,openGraph}`
   (spec §10.3), but no Java or TypeScript code reads `noIndex`; the sitemap lists every site page. Templates own
   `<title>`, meta description and `lang` (template developer guide §§ on `$CMS_META(language)$`, hreflang); the sitemap
   adds `hreflang` alternates itself in localized projects.
8. **Section markers don't exist server-side.** The preview frame forwards clicks on `[data-sf-instance]`
   (`features/preview/preview.frame.component.ts:42`–`:79`, spec §19.3), but no server code emits the attribute — so
   "jump to the section" needs markers written by the check render itself.
9. **Page editor ignores issues.** `PageView.issues` is returned by `PageController` (`:188`), `sf-content-form`
   has an `issues` input (`:53`), but only `features/content/record-editor.component.html:64` binds it; the page editor
   (`page-editor.component.html:157`) doesn't.
10. **SSRF stance.** Spec §26.3 / `docs/security-review.md:23`: no server-side fetch of user-supplied URLs, no runtime
    HTTP client. External link checking would change that — it is out of scope.
11. **Roles for URL-shaping settings.** `UrlRegistryController`: read `VIEWER`, override `DEVELOPER`, reset
    `PROJECT_ADMIN`. Targets: create `DEVELOPER`, update/delete `PROJECT_ADMIN` (`TargetController`).

## Decisions (binding for all tasks — revisit only with the user)

1. **Internal checks only, no network.** Every `href`/`src`/`srcset` in rendered HTML is resolved against the build.
   `http(s)` URLs pointing at the target's own `baseUrl` count as internal; every other absolute URL, `mailto:`,
   `tel:`, `javascript:` (already stripped by OCTL) and `data:` is skipped. Spec §26.3 stays as it is.
2. **jsoup** (new library in `gradle/libs.versions.toml`, used by `sf-generate` only) parses every output of an
   **HTML channel** (the channel's file extension is `html`/`htm`). Other channels (Markdown, …) are not checked; the
   rule table says so.
3. **Rule SPI, two kinds.** `QualityRule` implementations are either **page-local** (look at one parsed document:
   title, h1, alt, …) or **site-wide** (look at the facts of every output: duplicates, links, anchors, hreflang). Each
   rule has a code `SF-CHK-0xyz` (links `01xx`, SEO `02xx`, accessibility `03xx`), a category, a default severity
   (`WARNING`) and optional parameters (e.g. title length). The rule list is fixed in code; projects configure, they
   don't add rules.
4. **Configuration per project**: `project.quality_rule_config` (JSON) `{rules: {"SF-CHK-0201": {severity:
   "OFF"|"WARNING"|"ERROR", params:{…}}}}`; a missing entry means the default. `GET /projects/{key}/quality-rules`
   (`VIEWER`) serves every rule with name, category, description, default and effective severity and params;
   `PUT` (`DEVELOPER` — the templates own the markup) validates and stores it, records a revision (`PROJECT` summary
   entry `qualityRules`) and audits `QUALITY_RULES_UPDATED`.
5. **Severity effects.** `WARNING` findings are reported only: they do **not** make the run `PARTIAL` and are not
   counted in `warning_count`. `ERROR` findings on an output rendered in this run **hold the page back** (all its
   outputs in that channel and locale) with one `SF-GEN-0125` "Quality check failed" file error listing the codes, like
   `SF-GEN-0120` → run `PARTIAL`. Findings on carried outputs are reported but never hold anything back (they weren't
   rendered by this run).
6. **No cascade.** Page-local rules and link *existence* rules run first; errors hold pages back; only then are
   "link to a held-back page" findings (`SF-CHK-0103`) computed, and that rule's severity is capped at `WARNING`, so
   holding back one page never holds back the pages that link to it.
7. **Facts sidecar.** Every build writes `builds/{runId}.quality.json` next to its manifest (pruned with it): per HTML
   output its title, meta description, `h1` count, `lang`, canonical, hreflang alternates, element ids/anchors,
   outgoing internal links (resolved path + fragment) and its page-local findings. An incremental/scoped run takes
   carried outputs' facts and page-local findings from the base build's sidecar and re-runs only the site-wide rules
   over the whole site. A base build **without** a sidecar (built before M30), or a rule configuration changed since the
   baseline (`QUALITY_RULES_CHANGED`), makes an incremental request plan FULL (new `FallbackCause` values
   `BASE_BUILD_WITHOUT_QUALITY_FACTS`, `QUALITY_RULES_CHANGED`).
8. **Reference findings come from the renderer, not the HTML.** A reference to a deleted asset (`SF-GEN-0220`), to an
   unreleased asset (M27 `SF-GEN-0221`) or to a page uuid missing from the snapshot (today `SF-GEN-0204`, which fails the
   run) is recorded **per rendering output** during RENDER and becomes a finding `SF-CHK-0105` (deleted) /
   `SF-CHK-0104` (unreleased) / `SF-CHK-0101` (missing) on the page that links. A missing link target no longer fails
   the whole run; the render diagnostic stays as today for deleted/unreleased (renders `""`).
9. **Findings store.** Table `generation_run_finding` (run_id, asset_uuid, channel, locale, page_number, output_path,
   rule/code, category, severity (effective at run time), message, selector (CSS path), section_instance_id nullable,
   carried boolean). Capped: at most `sf.quality.max-findings-per-output` (default 50) per rule and output and
   `sf.quality.max-findings-per-run` (default 100,000) per run, with a `truncated` count on the run. Deleted with the run
   (M29 run retention).
10. **Run view.** `GenerationRunView` gains `findingCounts {errors, warnings, byCategory{links,seo,accessibility},
    truncated}`; `GET /projects/{key}/generations/{runId}/findings` (`VIEWER`, paged, filters: severity, category,
    code, asset, channel, locale, output path prefix). New SSE stage `CHECK` "Checking output" between `ASSETS` and
    `POST`; clients tolerate unknown stage names already (verify in `generation-sse.ts`).
11. **Performance budget.** Checks may add at most 15 % to the full-build time of the 5,000-page fixture (§18.6) and run
    on the render's virtual-thread pool (`sf.generate.parallelism`); jsoup parses each output once and every page-local
    rule works on that one document.
12. **`noIndex` becomes real.** `nav.noIndex: true` excludes the page from `sitemap.xml`, is available to templates as
    `$CMS_META(noIndex)$`, and rule `SF-CHK-0212` reports a `noIndex` page whose HTML lacks
    `<meta name="robots" content="…noindex…">`. The page editor edits it next to the page's other navigation settings.
13. **Draft checks.** `POST /projects/{key}/preview/pages/{uuid}/checks` (`VIEWER`, read-only, allowed on archived
    projects) renders the page's draft (M27 `SnapshotView.DRAFT`, preview link rewriting **off**, so hrefs are real
    output paths) with section markers, runs the page-local rules and the link rules against the draft's planned
    output paths (no build, no cross-page anchor or duplicate checks) and returns findings plus the page's completeness
    `issues`. Section markers are HTML comments `<!--sf:section {instanceId}-->…<!--/sf:section-->` written **only** in
    this check render, never in preview or generation output.
14. **Redirect registry.** Table `redirect` (project_id, channel_key, locale_key, from_path, `to_asset_uuid` +
    `to_page_number` **or** `to_path`/absolute URL, kind `AUTO|MANUAL`, created_at, created_by, source_run_id,
    version). Automatic entries point at the **asset**, not a path, so the target is resolved at build time to the
    page's current output path in that channel and locale — chains collapse by construction and later moves follow.
15. **Detection.** Every successful build (FULL included — it reads the target's current manifest even when it has no
    base) compares each new PAGE output (asset, channel, locale, page number) with the same key in the current manifest;
    a different path adds `AUTO` old → asset. Removed outputs (unpublished, deleted, fewer paginated pages) add nothing
    (user decision). New entries are persisted **after** `publish` succeeds, in one transaction with the run's REPORT;
    a failed or cancelled run adds none.
16. **Normalization at build time.** An entry whose `from_path` is a live output of this build is **shadowed** (not
    emitted, kept, shown as such); an entry whose target is not in the build (unpublished, deleted, other channel) is
    **dangling** (not emitted, kept); an entry whose resolved target path equals its `from_path` is dropped as a loop;
    manual entries that would loop are rejected with `422 SF-DOM-0192`. Duplicate `from_path` per (channel, locale) is
    rejected (`409 SF-DOM-0191`); a new AUTO entry replaces an existing AUTO entry with the same `from_path`, never a
    MANUAL one.
17. **Manual redirects**: `GET/POST/PUT/DELETE /projects/{key}/redirects` (`VIEWER` read, `DEVELOPER` write, like URL
    registry overrides; `If-Match` on the version), audited `REDIRECT_CREATED/UPDATED/DELETED` (AUTO entries are not
    audited; their `source_run_id` tells where they came from). `POST /projects/{key}/redirects/for-asset` creates one
    MANUAL entry per current output path of an asset (from the default target's current manifest) — used by the M27
    unpublish/delete dialog; allowed to whoever may unpublish/delete that asset (M28 `RELEASE` permission) as well as
    `DEVELOPER+`.
18. **Output formats per target**: target config `redirectFormats` ⊆ `["HTML_STUB","HTACCESS","JSON"]`, default
    `["HTML_STUB"]`. HTML stubs are written at `from_path` (meta refresh 0, `<link rel="canonical">` absolute when the
    target has a `baseUrl`, `location.replace` JS fallback, `<meta name="robots" content="noindex">`, a visible link);
    the stub's link is **relative to the stub's own path** (lessons: "links relative to the current page"). `.htaccess`
    `RedirectMatch 301 "^<regex-escaped decoded url-path>$" "<url-path-or-URL>"` (anchored; `$`, `&` and `\` in the
    target escaped) needs site-root URL paths (prefixed with the `baseUrl` path when it has one). *Decision amended by
    the user 2026-09-27: RedirectMatch, anchored, because `Redirect` matches by prefix* (a directory source would also
    redirect the live pages below it). All three are `SITE` outputs in the manifest; stubs never appear in `sitemap.xml` or `search-index.json`.
    A stub whose path collides with a real output is shadowed (decision 16), never a build error.
19. **Error codes.** Checks `SF-CHK-0001` (output could not be checked) and `SF-CHK-0101…0399` (one per rule, catalogue
    in feature 2); hold-back `SF-GEN-0125`; redirects `SF-DOM-0190` (redirect not found, `404`), `SF-DOM-0191`
    (duplicate source path, `409`), `SF-DOM-0192` (redirect loop, `422`), `SF-DOM-0193` (invalid source or target: `..`,
    outside the site, unsafe scheme, `422`), `SF-DOM-0194` (asset has no published output, for-asset, `422`); a stale
    `If-Match` is the usual `SF-API-0409`.
20. **Export/import.** Full-project archives carry the redirect registry; export protocol **9** (M27 moves it to 8).
    Quality rule config travels with the project settings in the same archive.

## Exit criteria (epic is done when)

- [x] A full build of a fixture site reports every seeded defect (broken page/media link, missing anchor, link to an
      unreleased and to a deleted page, missing title/description/h1, duplicate title, missing alt, heading skip,
      duplicate id, unlabeled input, untitled iframe, missing lang, noIndex page without robots meta) with the right
      code, page, channel, locale and selector — and nothing on the clean pages (golden fixture).
- [ ] Rule configuration per project works: `OFF` silences a rule, `ERROR` holds the page back (run `PARTIAL`,
      `SF-GEN-0125`), warnings leave a clean run `SUCCESS`.
- [ ] An incremental run reuses carried outputs' facts and findings, re-runs site-wide rules, and reports a broken
      link in a carried page after its target was unpublished; a pre-M30 base or a changed rule config plans FULL with
      the new fallback cause.
- [ ] A link to a missing page uuid no longer fails the run; it is a finding on the linking page.
- [ ] The page editor shows completeness issues and draft check findings, and jumps to the field or section.
- [ ] Moving or renaming a released page and building adds an AUTO redirect; the next build of each configured format
      contains a working stub / `.htaccess` line / JSON entry; moving it again keeps one hop; putting a new page at the
      old path shadows the redirect; manual redirects can be added, edited and deleted; unpublish offers a redirect.
- [ ] The 5,000-page fixture's full build stays within +15 % of its pre-M30 time (documented result).
- [ ] `./gradlew build` (`test --rerun`), `ui` `npm run build` and `npx vitest run` green; the Playwright journey green.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [check-framework](01-check-framework/README.md) | backend | `M27` |
| 2 | [rules](02-rules/README.md) | backend | 1 |
| 3 | [editor-issues](03-editor-issues/README.md) | fullstack | 2 |
| 4 | [redirect-registry](04-redirect-registry/README.md) | backend | `M27`; 4.2 also 1.3 |
| 5 | [redirect-output](05-redirect-output/README.md) | backend | 4 |
| 6 | [ui](06-ui/README.md) | frontend | 1, 2, 4, 5 (per task) |
| 7 | [docs-e2e](07-docs-e2e/README.md) | qa | 1–6 |

Features 1–3 and 4–5 are two lanes (packages `generate/quality/` vs `redirect/` + `generate/postprocess/`):
`M30.4.1` can start at once; `M30.4.2` waits for `M30.1.3`, because detection works on the output set after
hold-back. Both lanes touch `GenerationService.executeRun` — coordinate that one method.

## Dependencies

`M27` (release state and `SnapshotView.DRAFT|RELEASED`, `SF-GEN-0221` unreleased references, the unpublish/delete
dialogs, localized media paths), `M28` (`RELEASE` permission for the for-asset redirect), `M22` (build manifests,
baseline and `FallbackCause`), `M24` (locales, hreflang), `M21` (pagination outputs), `M26` (archived-project guard,
audit). `M29` run retention deletes findings with their runs and must keep runs whose build is still retained (their
sidecar and findings back carried outputs).

## Notes

- **API shape.** Project-scoped endpoints under `/projects/{key}/…` with `@projectAuth`; regenerate OpenAPI and
  `ui/src/app/core/api/generated/schema.d.ts` after each backend task that changes the API. `quality-rules` and
  `redirects` writes are refused on archived projects by the M26 interceptor (no annotation needed); the draft-check
  `POST` carries `@AllowedOnArchivedProject("read-only check render")` and joins the endpoint-walk allowlist.
- **Not in scope:** external link checking (network access), colour contrast and other checks that need a browser
  (layout, computed styles), runtime crawling of the published site, checks of non-HTML channels, CSS `url()` in
  processed text media, redirect rules with wildcards/regex, nginx map and `_redirects` formats (not chosen), automatic
  redirects for removed outputs, per-page rule overrides, adding custom rules per project.
- **Spec follow-up** (in `M30.7.1`): §15.2 (`noIndex`), §16.4 (missing link targets no longer fail a run), §18.2
  (`CHECK` stage, redirects in POST, new fallback causes), §18.4 (`redirectFormats`, `quality.json` sidecar), §18.5
  (findings), §19 (draft checks), §20.2 (new endpoints), §24 (Issues panel, Quality and Redirects tabs, run findings),
  §26.3 (SSRF unchanged — say so), Appendix B (`SF-CHK-*`, `SF-GEN-0125`, `SF-DOM-0190`–`0194`).
