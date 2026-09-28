# Quality check fixtures (M30)

Fixture HTML for the build-time quality rules (`SF-CHK-*`, `generate/quality/`). Shared by the three rule lanes
(`M30.2.1` links, `M30.2.2` SEO, `M30.2.3` accessibility) and the golden build.

## Layout

```
quality/
  README.md                  this file
  framework/                 the check framework's own tests (M30.1.x)
  links/                     SF-CHK-01xx fixtures (M30.2.1)
  seo/                       SF-CHK-02xx fixtures (M30.2.2)
  a11y/                      SF-CHK-03xx fixtures (M30.2.3)
  golden/                    the golden fixture's templates (GoldenQualityFixtureIntegrationTest)
  expected-findings.json     every finding of the golden build, sorted, one per line
```

## Naming

- One file per case: `<code>-<pass|fail>[-<variant>].html`, lower case, e.g. `a11y/0301-fail.html`,
  `a11y/0301-pass-empty-alt.html`, `links/0107-fail-cross-page.html`.
- A `fail` fixture must produce at least one finding of its code; a `pass` fixture must produce none of it. Assert the
  exact codes, selectors and messages in the test — a fixture file is data, not an expectation.
- Keep fixtures minimal: a complete `<html lang>` document with `<title>`, meta description and one `h1`, so that only
  the rule under test fires. Start from `framework/clean-page.html`.

## Running rules over fixtures without a build

`com.acme.staticforge.QualityRuleHarness` (test sources) runs page and site rules exactly in the build's order
(page rules, site rules, hold-back, rules after the hold-back) over declared outputs:

```java
QualityRuleHarness.Result result = QualityRuleHarness.of(new MissingAltRule())
        .pageFromFixture("index.html", "a11y/0301-fail.html")
        .media("assets/media/logo.png")
        .run();
assertThat(result.of("SF-CHK-0301")).extracting(Finding::selector).containsExactly("body > header > img");
```

Outputs are declared with their site path; links in fixtures are resolved against it (relative to the output, root
relative, or absolute under the harness `baseUrl` `https://example.com`). Declare every target a fixture links to
(`page`, `media`, `siteFile`), held-back pages (`heldBack`), renderer reference events (`event`) and redirect sources
(`redirectSource`).

## Full builds

`com.acme.staticforge.QualityBuildFixtures` (test sources, M30.1.3) builds a small project through the services, runs
a generation, and reads the stored findings of the run — use it for anything that needs the renderer (reference events,
hold-back in a real build, incremental runs) and for the golden fixture.

A test that asserts the findings of some rules can switch the rest off with `QualityBuildFixtures.only(fx, codes)`, so
rules added later (by another lane) don't disturb it.

## Link fixtures (`links/`, M30.2.1)

`com.acme.staticforge.LinkRulesTest` serves each fixture at `docs/guide.html` in one site (locales `en`/`de`, a
paginated blog, a pretty-URL page, a Markdown channel, media, a site file, the held-back page `held.html` and the
redirect sources `old.html`, `old-section/index.html`, `de/docs/alt.html`) and runs every link rule on it, so a fixture
also shows which neighbouring rule a case belongs to. `reference-fail.html`/`reference-pass.html` are the rendered
output of a page whose `$CMS_REF`s did (not) resolve: `SF-CHK-0104`, `0105` and the missing-target case of `0101` come
from the renderer's reference events the test declares with them, not from the markup. Build-level cases (reference
events with the field path, carried pages in incremental runs, `SF-GEN-0120` hold-back) are in
`LinkRulesIntegrationTest`.

## Golden fixture (`golden/`, `expected-findings.json`)

`com.acme.staticforge.GoldenQualityFixtureIntegrationTest` builds one real site end to end with the production rule set
at its defaults: languages `de`, `en` and `de-CH` (falling back to `de`), an HTML and a Markdown channel, an abstract
`layout` that every page template extends (`golden/*.html`; `golden/page.md` is every template's Markdown source), a
paginated news page and a media image. The defect templates override one layout block each (`untitled`, `no-lang`,
`no-robots`) or add broken markup (`broken-links`, `opening-hours`); content seeds the rest (an English-only
description, two pages with the same English title, links to an unpublished and to a deleted page). Home, About,
News (both page numbers), the posts and the `noIndex` page "Private" are clean.

The stored findings must equal `expected-findings.json` exactly: output path, channel, locale, page uid, code,
severity, selector and message (an entry may leave its `message` out; then it is not compared). After a deliberate
change, regenerate the file and review the diff:

```
./gradlew :server:sf-app:test --tests "*GoldenQualityFixtureIntegrationTest" -Pfrontend.skip=true --rerun \
    -Dsf.quality.golden.update=true
```

(or `SF_QUALITY_GOLDEN_UPDATE=true`). Without it the test only compares.
