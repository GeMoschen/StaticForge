---
id: M30.2.2
status: done
depends: [M30.1.3]
epic: m30-quality-checks-and-redirects
feature: rules
area: backend
---

# M30.2.2 — SEO rules (`SF-CHK-0201`–`0212`) and `nav.noIndex`

## Context

`generate/quality/`, `postprocess/SitemapPostProcessor` (hreflang alternates, `x-default`), `CarryForward.sitePages`,
`GenerationRenderer` (`$CMS_META` keys at `:206`–`:224`), page payload `nav{visible,position,label,noIndex}` (spec
§10.3, unused in code), `PageServiceImpl` (`nav.visible` default at `:70`–`:72`), M24 locale config and
`$CMS_META(language)$`, M21 `CMS_PAGINATION.canonicalHref`, page editor navigation settings
(`features/pages/page-editor.component.*`). Epic decision 12; rule catalogue in the feature README.

## Goals

- Page rules `0201`–`0204`, `0207`–`0209`, `0212`; site rules `0205`, `0206` (group by channel + locale, report every
  member of a duplicate group with the other paths in the message, max 10 named), `0210`, `0211`.
- `0209`: `<html lang>` primary subtag must equal the render locale's language (`de-CH` page with `lang="de"` passes;
  `lang="en"` fails); non-localized projects skip it.
- `0210` (localized projects): each localized page output's alternates must name every locale in which that page has
  an output (after M27 per-locale release), point at existing outputs, be reciprocal, and not name held-back or
  unreleased locales. Pages without any `hreflang` are fine unless the project has more than one locale **and** the
  page exists in more than one of them.
- `0211` canonical: when present it must resolve to an existing output (paginated pages may point at page 1 or
  themselves); absolute when the target has a `baseUrl`; param `required` (default `false`) makes a missing canonical a
  finding.
- **`noIndex`.** `PageServiceImpl`/validation accept `nav.noIndex` (boolean, default `false`); `SitemapPostProcessor`
  leaves out every output of a `noIndex` page (`SitePage` gains `noIndex`); `$CMS_META(noIndex)$` renders `true`/`false`;
  `0212` reports a `noIndex` page whose HTML has no robots meta containing `noindex`. Page editor: a "Hide from search
  engines" switch next to the page's navigation settings (find where `nav.visible` is edited; if nowhere, add both to
  the page properties area) — small UI change, done here.
- Rule fixtures under `quality/seo/`.

## Acceptance criteria

- [x] Fixtures for each rule incl. localized (`de`, `en`, `de-CH` fallback) and paginated cases.
- [x] `noIndex`: sitemap without the page (all page numbers, all locales), `$CMS_META(noIndex)$` in a golden render,
      `0212` positive/negative, the editor switch saves `nav.noIndex` (vitest spec + manual check).
- [x] Duplicate rules don't report across channels or locales.
- [x] `./gradlew build`, `ui` `npm run build` and `npx vitest run` green.

## Out of scope

- Open Graph / social tags, structured data (JSON-LD), `meta.description` as a standard field (templates own their
  markup; a later epic may add standard SEO fields).

## Notes / hazards

- Title/description text: jsoup `text()` normalizes whitespace; measure length in code points after trimming.
- `noIndex` changes the sitemap of existing projects only when someone sets it — default `false`, no migration.
- A `noIndex` change must re-plan the sitemap: site files are always rewritten from the full list (§18.4), so no
  planner change is needed — verify with an incremental test.
- Deviation: `$CMS_META(noIndex)$` alone can't drive a conditional robots meta (meta keys weren't readable in
  expressions), so `CMS_META` is now also a read-only expression root: `$CMS_IF(CMS_META.noIndex)$<meta name="robots"
  content="noindex">$CMS_END_IF$` (`OctlCompiler.META_ROOT`; `$CMS_SET`/loop variables can't take the name). Docs:
  M30.7.1 (template guide: `noIndex` meta key, `CMS_META.` root).
- Deviation: the length rules reject `min > max` on `PUT /quality-rules` through a new `QualityRule.paramsProblem` hook
  (a stored pair that doesn't fit falls back to the defaults).
- `noIndex` pages are left out of `0205`/`0206` duplicate groups (search engines don't list them); `0210` runs after the
  hold-back (reads held-back paths) and is capped at `WARNING`; `0211` runs before it and may be an `ERROR`.
- `0210` reciprocity is per page and language, not per page number: page 2 may name page 1 of the other languages, as
  `CMS_LOCALES` hrefs do. An output without any alternates is only reported on itself, not as "not answered".
- Fixed on the way: paginated outputs lost their locale in `CarryForward.sitePages()` (no sitemap alternates for pages
  2..N of a localized paginated page). A scoped run lists carried out-of-scope pages with the page's current
  `nav.noIndex` (the base build doesn't record it; the sitemap is rewritten whole each run).
- `CheckEnvironment` has a new constructor taking `Predicate<OutputKey> noIndex`; the old one reads "no page is
  noIndex". Draft checks (M30.3.1) should pass the draft's `nav.noIndex` so `0212` works there.

