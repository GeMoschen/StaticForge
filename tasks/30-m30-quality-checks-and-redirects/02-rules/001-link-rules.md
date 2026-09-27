---
id: M30.2.1
status: done
depends: [M30.1.3]
epic: m30-quality-checks-and-redirects
feature: rules
area: backend
---

# M30.2.1 — Link rules (`SF-CHK-0101`–`0109`)

## Context

`generate/quality/` (`SiteRule`, `SiteIndex`, `LinkRef`, reference events from `M30.1.3`), `BuildManifest` (output
kinds and channels), channel settings (`indexFileName`, `urlStrategy`, `trailingSlash`, §18.3), the redirect registry
(`M30.4.*`, for `0109` — optional dependency, see notes). Epic decisions 1, 6, 8; rule catalogue in the feature README.

## Goals

- `0101` a resolved internal path that is no output of the build (new, carried, media, site files) and no redirect
  stub; `0102` the same for `img/source/video/audio/script/link` targets (media); a path that exists as a stub is **not**
  0101 but `0109`.
- `0103` target is a page output held back in this build (computed after hold-back, severity capped at `WARNING`).
- `0104`/`0105` from the renderer's `UNRELEASED`/`DELETED` reference events, attributed to the output that rendered
  them; `MISSING` events are reported as `0101` with the target uuid in the message. Message names the **target**
  (uid/display name, asset type) and the editor path when known.
- `0106` target output belongs to another channel (e.g. an HTML page linking a `.md` output).
- `0107` `#fragment` not among the target output's ids/anchors (same-page fragments check the page itself; `#` alone
  and `#top` are fine; fragments on media are ignored).
- `0108` `a[href]` empty, whitespace or `#`, unless it carries `role="button"` or an `onclick`-free `aria-` pattern
  documented in the rule description (keep it simple: empty/`#` → finding).
- `0109` target path is the `from_path` of an emitted redirect (the link works but costs a hop — fix it to the new URL).
- Rule fixtures under `server/sf-app/src/test/resources/quality/links/` plus the shared golden project.

## Acceptance criteria

- [x] Positive and negative fixture per rule (relative, root-relative, `baseUrl`-absolute, pretty URL, `srcset`,
      paginated page 2, localized paths `de/…`).
- [x] Incremental: page A (carried) links page B; B is unpublished (M27) and the next incremental run reports `0101` on
      carried A with `carried = false` (site rules run fresh) — no hold-back of A.
- [x] A link to a page held back by `SF-GEN-0120` is `0103` warning even when `0103` is configured `ERROR`.
- [x] `./gradlew build` green.

## Out of scope

- External URLs (decision 1), CSS `url()` in processed text media, anchors inside media (PDF `#page=`).

## Notes / hazards

- `0109` needs the build's emitted redirect set, which exists only after `M30.5.1`: this task registers the rule and
  gives `SiteIndex` an (empty) `redirectSources` set; `M30.5.1` fills it and adds the `0109` fixture.
- Links carried from the base sidecar were resolved against the *base* build's paths; resolve again against this
  build (paths are stored resolved, so this is a lookup, not a re-parse).
- Don't double-report: an `UNRELEASED` reference renders `""`, which would also trigger `0108` on the `<a href="">` —
  suppress `0108` for elements that carry a reference event.
- Done: one class per code in `generate/quality/rules/links/` (`MissingLinkTargetRule` 0101, `MissingMediaRule` 0102,
  `HeldBackTargetRule` 0103, `UnreleasedTargetRule` 0104, `DeletedTargetRule` 0105, `OtherChannelTargetRule` 0106,
  `MissingAnchorRule` 0107, `EmptyLinkRule` 0108 (page rule), `RedirectedTargetRule` 0109); shared walk in `LinkScan`.
  Fixtures `server/sf-app/src/test/resources/quality/links/`, harness tests `LinkRulesTest`, builds
  `LinkRulesIntegrationTest`.
- Deviation: `0109` is implemented and unit-tested against a harness `SiteIndex` with redirect sources; the build-level
  `0109` fixture comes with `M30.5.1`, which fills `SiteIndex.redirectSources` in `QualityCheckStage`.
- Deviation: reference events carry no element, so `0108` can't tell *which* `href=""` a reference rendered. It skips
  empty (not `#`) hrefs on an output whose renderer reported an unresolved page/media/folder reference
  (`CheckEnvironment.referenceEvents`, new); `0101`/`0104`/`0105` report that page, naming the target.
- Deviation (framework): `ReferenceEvent.editorPath` (new) is filled in the CHECK stage from the rendering page's payload
  (`EditorPaths`, same scan as the reference table's `source_path`) — the "editor path when known"; `null` for
  template-written references. The sidecar entry now keeps an output's reference events (`QualitySidecar.Entry
  .references`), and carried outputs bring them back: without that, `0104`/`0105` vanished from every incremental run
  that carried the linking page.
- Link rules leave the canonical link and `hreflang` alternates to the SEO rules (`0210`/`0211`), so one broken
  `<link>` is reported once. `0106` and `0101` look at navigation (`a`, `iframe`), `0102` at `img/source/video/audio/
  script/link` (incl. `srcset`, `poster`).
- A build with unreleased/deleted references is still `PARTIAL` through the unchanged render warnings
  `SF-GEN-0220`/`0221` (decision 8 keeps them); the findings add nothing to the status.
- `QualityCheckStageIntegrationTest` now switches the production rules off per project (`QualityBuildFixtures.only`):
  it asserts the test rules' exact findings. The SEO/a11y lanes need the same (or nothing more) there.
