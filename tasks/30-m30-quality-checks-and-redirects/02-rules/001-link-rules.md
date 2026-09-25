---
id: M30.2.1
status: todo
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

- [ ] Positive and negative fixture per rule (relative, root-relative, `baseUrl`-absolute, pretty URL, `srcset`,
      paginated page 2, localized paths `de/…`).
- [ ] Incremental: page A (carried) links page B; B is unpublished (M27) and the next incremental run reports `0101` on
      carried A with `carried = false` (site rules run fresh) — no hold-back of A.
- [ ] A link to a page held back by `SF-GEN-0120` is `0103` warning even when `0103` is configured `ERROR`.
- [ ] `./gradlew build` green.

## Out of scope

- External URLs (decision 1), CSS `url()` in processed text media, anchors inside media (PDF `#page=`).

## Notes / hazards

- `0109` needs the build's emitted redirect set, which exists only after `M30.5.1`: this task registers the rule and
  gives `SiteIndex` an (empty) `redirectSources` set; `M30.5.1` fills it and adds the `0109` fixture.
- Links carried from the base sidecar were resolved against the *base* build's paths; resolve again against this
  build (paths are stored resolved, so this is a lookup, not a re-parse).
- Don't double-report: an `UNRELEASED` reference renders `""`, which would also trigger `0108` on the `<a href="">` —
  suppress `0108` for elements that carry a reference event.
