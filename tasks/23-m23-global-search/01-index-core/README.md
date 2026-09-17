# Feature: Index core

**Spec:** New. Supports §20 (search endpoint, feature 3) and §26.1 (performance). Lives in
`sf-domain`, package `com.acme.staticforge.search` (see epic Notes on module placement).

## Goal

Build the embedded Lucene foundation that the lifecycle (feature 2) and query API (feature 3) sit on:

- **Index service.** `SearchIndexService` owns one Lucene `Directory` + `IndexWriter` +
  `SearcherManager` per project, opened lazily. It exposes document upsert/delete by asset UUID,
  commit, near-real-time refresh, per-project revision stamp read/write, and a query entry point.
- **Document model.**
  - Stored/keyword fields: `uuid`, `type`, `uid`, `displayName`, `folderPath`, `templateUuid`,
    `revision`.
  - Analyzed text fields: `title` (display name + uid), `text` (language-neutral: standard
    tokenizer + lowercase + ASCII folding), `text_de` (German analyzer), `text_en` (English
    analyzer).
- **Text extraction.** A registry of `SearchTextExtractor`s, one per `AssetType`. Each turns a
  `SnapshotAsset`-like view (type, uid, display name, folder path, payload) into a
  `SearchDocument`. Page extraction walks the page's `content` and every body section's `content`
  using the template's `ContentDefinition`: text/textarea/markdown/richtext get tags stripped,
  select labels are included, references and media values are skipped, and list/catalog items are
  recursed into.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-lucene-search-index-service.md](001-lucene-search-index-service.md) | — |
| 2 | [002-text-extraction.md](002-text-extraction.md) | 1 |

## Feature exit criteria

- [x] Lucene is on `sf-domain`'s classpath only, pinned via the version catalog;
      `checkModuleLayers` is green.
- [x] `SearchIndexService` can upsert, delete and query documents per project, with directories
      isolated per project. Unit tests cover in-memory and filesystem directories.
- [x] An extractor exists for every current `AssetType`. Each has a unit test on a representative
      payload, including a nested list/catalog page and a rich-text value with markup.
- [x] Nothing is wired to live writes yet. Lifecycle is feature 2.

## Dependencies

`M16.1.1` (compiled template/CDL cache; extraction needs a page's `ContentDefinition`), `M16.5.2`
(content validated against CDL on save, so extraction can rely on value shapes).
