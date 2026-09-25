# Feature: Redirect output — HTML stubs, `.htaccess`, `redirects.json` per target

**Spec:** Extends §18.2 (POST), §18.4 (target config `redirectFormats`, `SITE` outputs).

## Goal

Turn the build's active redirects into something the host serves: stub pages that work on any static host, Apache
rules for Apache hosts, and the machine-readable JSON — chosen per target.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-redirect-formats-per-target.md](001-redirect-formats-per-target.md) | `M30.4.2` |

## Feature exit criteria

- [ ] Each format is written when configured and only then; stubs redirect in a browser; `.htaccess` passes an
      Apache config test (or a documented parser test).
- [ ] Stubs never collide with real outputs and never appear in sitemap or search index.
- [ ] `./gradlew build` green.

## Dependencies

`M30.4.2` (the build's redirect set), `GenerationTarget` config JSON and `TargetController`, `PostProcessStage`,
`RedirectPostProcessor`, `SitemapPostProcessor`, `SearchIndexPostProcessor`, `CarryForward.publication()`.
