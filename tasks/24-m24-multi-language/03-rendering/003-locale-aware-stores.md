---
id: M24.3.3
status: done
depends: [M24.3.2, M17.3.1, M19.3.2, M21.3.1, M23.1.2]
epic: m24-multi-language
feature: rendering
area: backend
---

# M24.3.3 — Locale-aware global sets, dataset records, pagination and search

## Context

`M17` adds `GLOBAL_SET` assets read via `$CMS_VALUE(global:set.field)$` /
`$CMS_GLOBAL.set.field$` (`M17.3.1`). `M19` adds `DATASET`/`RECORD` assets and
`$CMS_FOR(r : dataset:uid, where=…, sort=…, limit=…)$` over a pure query model
(`M19.3.1`/`M19.3.2`). `M21` adds the `pagination` editor and `$CMS_PAGINATION$` scope
with planner-computed page counts (`M21.2.1`/`M21.3.1`). `M23` adds a Lucene index with
per-asset-type text extraction (`M23.1.2`) and `GET /search` (`M23.3.1`). All four were
designed single-language; this task makes them honor the locale dimension from
M24.2.1–M24.3.2.

## Goals

- **Global sets:** CDL `localizable` works in global set schemas (validation + migration
  from M24.2.* apply via the shared hooks); `$CMS_GLOBAL$`/`global:` values resolve with
  the render locale chain. A change to only one locale's global value plans all pages
  depending on that set for **that locale only** (extend M24.3.2's narrowing to
  dependency edges whose target change is locale-only).
- **Dataset records:** localizable record fields resolve per render locale; `where` and
  `sort` in the dataset query model evaluate against the **resolved** value for the render
  locale (so `sort="title"` sorts German titles for `de` output); sort uses a
  locale-aware `Collator` when a locale is present, `Locale.ROOT` ordering otherwise.
- **Pagination:** item counts are computed per locale when the source query's `where`
  touches a localizable field (otherwise shared); `{pageNumber}` path patterns compose
  with `{locale}` (`en/blog/page/2/`); `$CMS_PAGINATION.*Href$` stay within the locale.
- **Search (Lucene):** extraction emits locale-suffixed fields for localizable values
  (`text_de`, `text_en`) plus a locale-neutral field for non-localizable text; analyzers
  per language where Lucene ships one (`GermanAnalyzer`, `EnglishAnalyzer`, fallback
  `StandardAnalyzer`); `GET /search?locale=` searches that locale's fields + neutral
  fields, default = all locales; results report which locale matched. Index documents
  must be rebuilt when project locales change (trigger M23.2.2's reindex).
- Golden/integration tests for each of the four.

## Acceptance criteria

- [x] `$CMS_GLOBAL.site.tagline$` renders `de`/`en` values on the respective pages; an
      `en`-only global change rebuilds only `en` entries of dependent pages.
- [x] A dataset with localizable `title` sorts differently for `de` vs `en` output (test
      with umlauts: `Äpfel` sorts before `Birnen` in `de`).
- [x] Pagination over a dataset filtered on a localizable field produces the correct page
      count per locale; hrefs stay in the locale.
- [x] Search for a German word with `locale=de` finds the page via stemming; the same query
      with `locale=en` does not match `en`-only fields.
- [x] Changing project locales triggers a reindex; search results reflect the new locale set.
- [x] Non-localized projects: M17/M19/M21/M23 test suites unchanged and green.
- [x] `./gradlew build` green.

## Out of scope

- UI for locale switching in globals/records (M24.4.1) and search filters in the palette
  beyond passing the current editing locale (M24.4.1 wires it).

## Notes / hazards

- This task depends on four other epics' internals; if any of those designs changed during
  implementation, re-read their task files before starting and update this file's Goals
  rather than bending their code.
- Per-locale pagination counts multiply plan work; keep the count computation on the
  snapshot (no rendering) as M21.2.1 requires.

## Implementation notes (2026-09-17)

- **Global sets and records** needed no special renderer code: their values arrive through
  `AssetValueResolver` and so pass the same one-shot `L10nValues` resolution in `OctlRenderer` that
  a page's own values do.
- **Dataset queries** resolve records for the render language *before* the query runs
  (`RecordView.resolvedFor`), so `where` and `sort` compare the rendered language; sorting uses a
  `Collator` for that language (`Äpfel` sorts with the A's), and a project without languages keeps
  the fixed language-independent collation exactly as before.
- **Pagination** composes automatically: `{locale}` is expanded by the same
  `OutputPathExpander.resolvePaginationPath`, and a paginated page is planned per language, so its
  page-2 hrefs stay inside the language.
- **Search** indexes a language-dependent value's text into that language's analyzer field
  (`text_de`, `text_en`) while the neutral `text` field keeps everything, so an unfiltered search is
  unchanged; `GET /search?locale=` reads one language's field. Changing a project's languages
  requests a rebuild (best-effort: a failure there never fails the settings change).
