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
  golden/                    the golden fixture project (templates, pages) and expected-findings.json
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
hold-back in a real build, incremental runs) and for the golden fixture (`golden/expected-findings.json`).
