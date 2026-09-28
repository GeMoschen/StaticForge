# Feature: Rules — links, SEO, accessibility

**Spec:** Extends §16.4 (missing targets), §15.2 / §10.3 (`nav.noIndex`), §18.2 (sitemap), new §18.7 "Quality
checks" (rule catalogue).

## Goal

The concrete rule set: internal link integrity, the SEO basics every page should have, and the accessibility checks
that static HTML can answer without a browser.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-link-rules.md](001-link-rules.md) | `M30.1.3` |
| 2 | [002-seo-rules-and-noindex.md](002-seo-rules-and-noindex.md) | `M30.1.3` |
| 3 | [003-accessibility-rules.md](003-accessibility-rules.md) | `M30.1.3` |

The three tasks are independent (one rule class per code under `generate/quality/rules/{links,seo,a11y}`) and can run
in parallel; they share the golden fixture project — agree on its folder first
(`server/sf-app/src/test/resources/quality/`).

## Rule catalogue (codes are binding)

| Code | Rule | Kind | Params |
|---|---|---|---|
| `SF-CHK-0001` | Output could not be checked | page | — |
| `SF-CHK-0101` | Link to a missing page or file | site | — |
| `SF-CHK-0102` | Link to missing media | site | — |
| `SF-CHK-0103` | Link to a page held back in this build (capped at warning) | site | — |
| `SF-CHK-0104` | Link to an unreleased asset | site (reference events) | — |
| `SF-CHK-0105` | Link to a deleted asset | site (reference events) | — |
| `SF-CHK-0106` | Link into another channel | site | — |
| `SF-CHK-0107` | Missing anchor (`#id` not on the target page) | site | — |
| `SF-CHK-0108` | Empty or `#`-only link | page | — |
| `SF-CHK-0109` | Link reaches only a redirect (old URL) | site | — |
| `SF-CHK-0201` | Missing or empty `<title>` | page | — |
| `SF-CHK-0202` | Title length | page | `min` 10, `max` 60 |
| `SF-CHK-0203` | Missing meta description | page | — |
| `SF-CHK-0204` | Meta description length | page | `min` 50, `max` 160 |
| `SF-CHK-0205` | Duplicate title (same channel and locale) | site | — |
| `SF-CHK-0206` | Duplicate meta description | site | — |
| `SF-CHK-0207` | No `h1` | page | — |
| `SF-CHK-0208` | More than one `h1` | page | — |
| `SF-CHK-0209` | `lang` doesn't match the render locale | page | — |
| `SF-CHK-0210` | `hreflang` alternates incomplete, not reciprocal or pointing nowhere | site | — |
| `SF-CHK-0211` | Canonical missing, not absolute when `baseUrl` is set, or pointing at a non-existent output | site | `required` false |
| `SF-CHK-0212` | `noIndex` page without a robots `noindex` meta | page | — |
| `SF-CHK-0301` | Image without `alt` attribute | page | — |
| `SF-CHK-0302` | Link without accessible text | page | — |
| `SF-CHK-0303` | Button without accessible text | page | — |
| `SF-CHK-0304` | Heading level skipped | page | — |
| `SF-CHK-0305` | Duplicate `id` | page | — |
| `SF-CHK-0306` | Form control without label | page | — |
| `SF-CHK-0307` | `iframe` without `title` | page | — |
| `SF-CHK-0308` | `<html>` without `lang` | page | — |

Every rule also declares where its findings are usually fixed, `QualityRule.fixHint()` (`fixHint` in
`GET /quality-rules`): `CONTENT`, `TEMPLATE` (the default) or `CONTENT_OR_TEMPLATE`, and says the same in its
`description`. Accessibility: `0301`, `0302`, `0304` `CONTENT_OR_TEMPLATE`; `0303`, `0305`–`0308` `TEMPLATE`.
`SF-CHK-0001` `TEMPLATE`.

## Feature exit criteria

- [x] Every rule has a positive and a negative fixture and appears in `GET /quality-rules`.
- [x] The golden fixture build reports exactly the seeded findings (`quality/expected-findings.json`) —
      `GoldenQualityFixtureIntegrationTest` (regenerate with `-Dsf.quality.golden.update=true`).
- [ ] Benchmark with the full rule set within budget (`M30.1.3`).
  — **Not met; accepted by the user on 2026-09-28 as measured**: about +20–30 % on the 4-core dev machine (cold JVM; warm ≈ +10 %); numbers in `M30.1.3`.
- [x] `./gradlew build` green.

## Notes

- Golden fixture (`GoldenQualityFixtureIntegrationTest`, templates in `quality/golden/`): de/en/de-CH (fallback de),
  HTML + Markdown channels, an abstract layout every template extends, a paginated news page, a media image; 49
  findings over 16 codes, nothing on the clean pages or in the Markdown channel. It found two pre-existing defects,
  fixed with their own tests: pagination item links lacked the `{locale}` prefix in localized projects
  (`PaginationIntegrationTest.aLocalizedListingLinksItsItemsInItsOwnLanguage`), and a media editor value's
  `heroImage.altText`/`.width` rendered empty (`CrossAssetValueRenderTest.aMediaEditorValueReadsThePickedMediasFields`).
- Decision (`SF-CHK-0205`/`0206` on paginated pages): every page number is its own URL, so page numbers of one
  paginated page that share a title (or description) are real duplicates for search engines and stay reported. Both
  rule descriptions tell the fix (`$CMS_META(pageNumber)$`); the golden news template does it and stays clean.

## Dependencies

`M30.1.3` (stage, `SiteIndex`, reference events), `M27` (unreleased references), `M24` (locales, fallback, hreflang
in the sitemap), `M21` (pagination outputs, `canonicalHref`).
