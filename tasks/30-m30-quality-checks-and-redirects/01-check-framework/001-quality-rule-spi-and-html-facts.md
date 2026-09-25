---
id: M30.1.1
status: todo
depends: []
epic: m30-quality-checks-and-redirects
feature: check-framework
area: backend
---

# M30.1.1 — Quality rule SPI, jsoup and per-output HTML facts

## Context

`gradle/libs.versions.toml` (no HTML parser today), `server/sf-generate` (`generate/` — new package
`generate/quality/`), `pipeline/OutputFile`, `pipeline/RenderedFile`, `render/RenderPipeline`,
`postprocess/SearchIndexPostProcessor` (regex tag stripping), channels (`OutputChannel`, file extension).
Epic decisions 1, 2, 3, 7, 11.

## Goals

- Add **jsoup** to the version catalog and to `sf-generate` only (check the licence — MIT — and the OWASP/dependency
  gate if wired).
- `HtmlFacts` — what one parsed HTML output tells the site-wide rules, extracted in one pass: `title`,
  `metaDescription`, `h1Count`, `lang`, `canonical`, `hreflang` alternates (`<link rel="alternate" hreflang>`),
  `robotsMeta`, the set of element `id`s and `<a name>` anchors, and every outgoing reference
  (`a[href]`, `link[href]`, `img[src]`, `img[srcset]`, `source[src|srcset]`, `script[src]`, `iframe[src]`,
  `video[src|poster]`, `audio[src]`) as `LinkRef(attribute, raw, resolvedPath | null, fragment, selector)`.
- **Resolution** (`LinkResolver`): relative to the output's own path (generated links are page-relative, lessons
  2026-09-15), root-relative against the site root, `http(s)` against the target `baseUrl` (internal only when it
  starts with it), percent-decoding, `?query` ignored, `./`/`../` normalized; anything escaping the site root, other
  schemes and external URLs resolve to `null` (skipped, decision 1). Pretty URLs: a path ending in `/` resolves to the
  channel's index file (`indexFileName`, §18.3).
- `QualityRule` SPI: `code()`, `category()` (`LINKS|SEO|ACCESSIBILITY`), `name()`, `description()`,
  `defaultSeverity()`, `params()` (typed, with defaults and bounds), and one of two shapes:
  `PageRule.check(ParsedOutput, RuleContext) → List<Finding>` or `SiteRule.check(SiteIndex, RuleContext) → List<Finding>`.
  `ParsedOutput` = jsoup `Document` + `HtmlFacts` + output key (asset, channel, locale, page number, path).
  `SiteIndex` = every output of the build (paths → key, kind, channel), facts of every HTML output (new and carried),
  the held-back set, and per-output reference events from the renderer (decision 8, filled by `M30.1.3`).
- `Finding(code, severity, message, selector, sectionInstanceId?)` with a **stable CSS selector** for the element
  (tag + id or nth-of-type path, short), so the UI can point at it.
- `QualityRuleRegistry` (Spring collects every `QualityRule` bean; codes unique, checked at start-up).
- `SectionMarkers`: when the document contains `<!--sf:section {id}-->…<!--/sf:section-->` comments (draft check
  render only, `M30.3.1`), a finding's element maps to the innermost enclosing section instance id.

## Acceptance criteria

- [ ] Unit tests for `LinkResolver`: relative, root-relative, `baseUrl`-absolute, pretty URL → index file, fragments,
      queries, encoded characters, `..` escaping the root, external/mailto/tel/data skipped.
- [ ] Unit tests for `HtmlFacts` over small fixture documents (every extracted field, `srcset` with several
      candidates and descriptors, duplicate ids kept as a multiset for the duplicate-id rule).
- [ ] Registry rejects duplicate codes at start-up (test).
- [ ] Selector is stable across two parses of the same document (test).
- [ ] `./gradlew build` green.

## Out of scope

- The rules themselves (`M30.2.*`), storage and configuration (`M30.1.2`), the pipeline stage (`M30.1.3`).

## Notes / hazards

- Parse with `Parser.htmlParser()` and **don't** re-serialize the document into the output — checks read, they never
  change bytes (an output written by a check-enabled build is byte-identical to one written with every rule `OFF`;
  assert it in `M30.1.3`).
- jsoup lower-cases tag and attribute names; ids are case-sensitive — keep them as written.
- Keep the facts small (they are persisted per output in the sidecar): cap stored ids/links per output (e.g. 2,000
  each) and record that the cap was hit.
