# Feature: Locale-aware rendering and generation

**Spec:** Extends §16.2 (`$CMS_META` keys — `language` appears in the §16.8 example but is
not implemented), §16.3 (filters), §16.5 (scopes), §18.2–§18.4 (plan, output paths,
targets), §18.6 (performance), §19 (preview), §17 (navigation URLs), and the URL registry
introduced in `M8.2`.

## Goal

Render every localizable value for a concrete locale with fallback, format dates and
numbers per locale, give templates a language switcher, and fan generation out over
page × channel × locale with `{locale}`-aware output paths, locale-keyed URL registry
entries and `hreflang` alternates — while a non-localized project plans and renders
exactly as before.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-locale-render-context.md](001-locale-render-context.md) | M24.2.1, M16.2.2 |
| 2 | [002-generation-locale-fanout.md](002-generation-locale-fanout.md) | 1, M24.2.2, M16.4.1, M22.1.1 |
| 3 | [003-locale-aware-stores.md](003-locale-aware-stores.md) | 2, M17.3.1, M19.3.2, M21.3.1, M23.1.2 |

## Feature exit criteria

- [ ] `RenderContext` carries a locale + fallback chain; localizable values, media
      metadata and nav labels resolve through it in generation and preview.
- [ ] `$CMS_META(locale)$`, `$CMS_META(language)$`, `$CMS_FOR(l : CMS_LOCALES)$` work;
      `date`/`number` are locale-aware and deterministic.
- [ ] Generation plans one entry per page × channel × locale, writes `{locale}` paths,
      detects collisions, and emits `hreflang`; incremental builds rebuild only changed
      locales where possible.
- [ ] Global sets, dataset records, pagination and search are locale-aware.

## Dependencies

`M16.2.2` (cross-asset values), `M16.4.1` (channel path settings in generation),
`M22.1.1` (plan reason chains), `M17.3.1`, `M19.3.2`, `M21.3.1`, `M23.1.2`.
