---
id: M23.1.1
status: done
depends: []
epic: m23-global-search
feature: index-core
area: backend
---

# M23.1.1 — Lucene dependency + `SearchIndexService` (per-project directory, document model, analyzers)

## Context

No search infrastructure exists:

- `AssetVersionRepository.search` is a JPQL `LIKE` on `displayName`.
- The only native query in the codebase is `UrlRegistryRepository.insertIfAbsent`.
- The version catalog `gradle/libs.versions.toml` has no Lucene entry. It pins `tika`,
  `metadataExtractor` and `jqwik` explicitly, the precedent for non-BOM libraries.
- `application.yml` has `sf.media.root` (`SF_MEDIA_ROOT`) and `sf.generate.output-root`
  (`SF_OUTPUT_ROOT`) as the precedent for disk roots.

The user chose an embedded Lucene index (2026-09-15).

## Goals

- **Dependencies.** Add `lucene` to `[versions]` (latest Lucene 10.x release; requires Java 21,
  which matches `java = "21"`). Add `lucene-core`, `lucene-analysis-common`, `lucene-queryparser`
  and `lucene-highlighter` library entries. Declare them on `server/sf-domain` only.
- **Configuration.** Add a `sf.search` configuration block:
  - `index-root: "${SF_SEARCH_INDEX_ROOT:./build/search-index}"`
  - `directory: filesystem | memory` (default `filesystem`; `memory` uses `ByteBuffersDirectory`
    for tests)
  - `refresh-interval` (NRT refresh; default `1s`)
  - `max-text-chars` (per-document text cap; default `200000`)
  - Bind it with a `@ConfigurationProperties` record, following existing `sf.*` property classes.
- **Service.** `com.acme.staticforge.search.SearchIndexService` (interface + impl):
  - One index per project at `{index-root}/{projectId}`. `projectId` is immutable and internal;
    never build the path from user input. Add a `startsWith(index-root)` guard as in
    `TargetLocations`.
  - Lazily opened `IndexWriter` (per project, thread-safe) + `SearcherManager`. Close them all on
    shutdown (`@PreDestroy`/`SmartLifecycle`) and close one project's index on `archive`.
  - Operations:
    - `upsert(projectId, SearchDocument)`: `updateDocument` keyed on the `uuid` term.
    - `delete(projectId, uuid)`
    - `commit(projectId, long indexedRevision)`: stores the revision in commit user data
      (`IndexWriter.setLiveCommitData`).
    - `indexedRevision(projectId)`: `OptionalLong`, read from the last commit's user data.
    - `deleteAll(projectId)`
    - `search(projectId, SearchQuery)`: returns `SearchHits`. The query API (M23.3.1) builds on
      it; this task only needs a basic term/phrase query path for tests.
- **Document model.** `SearchDocument` record with:
  - `uuid`, `assetType`, `uid`, `displayName`, `folderPath`, `templateUuid` (nullable),
    `revision`, `title`, `text`
  - Stored `snippetSource` for highlighting, capped by `max-text-chars`
- **Field mapping.** `SearchFields` constants:
  - `uuid`, `type`, `folderPath`: `StringField`, stored. `folderPath` also gets a prefix-queryable
    keyword field.
  - `uid`: `StringField`, plus a lowercased keyword field for exact and prefix matching.
  - `title`: `TextField` with the neutral analyzer, stored.
  - `text` (neutral), `text_de` (`GermanAnalyzer`), `text_en` (`EnglishAnalyzer`): `TextField`s.
  - `type`: also a `SortedSetDocValuesField` for facet counts.
- **Analyzers.** A `PerFieldAnalyzerWrapper`. The neutral analyzer is `StandardTokenizer` +
  `LowerCaseFilter` + `ASCIIFoldingFilter` (so `Häuser`/`hauser` meet). Add
  `GermanNormalizationFilter` where it helps umlaut transliteration (`ae` → `ä`). Name the German
  and English fields so `M24.3.3` can add `text_<locale>` fields later.

## Acceptance criteria

- [x] `libs.versions.toml` pins one `lucene` version; only `sf-domain/build.gradle.kts` uses the
      Lucene libraries; `./gradlew checkModuleLayers` is green.
- [x] `sf.search.*` properties are bound and documented in `application.yml`. `application-dev.yml`
      keeps the filesystem default under `./build/search-index`. The test profile/config uses
      `directory: memory`, or a JUnit temp dir per Spring context, so tests never share an index.
- [x] Unit tests (no Spring context) for `SearchIndexService`:
      - upsert then search finds the document;
      - a second upsert with the same UUID replaces it (one hit);
      - delete removes it;
      - two projects' indexes are isolated;
      - `commit(…, rev)` then reopen returns `indexedRevision == rev`;
      - the filesystem directory survives a close/reopen.
- [x] Analyzer tests:
      - `text_de` matches `Häuser` ↔ `Haus`;
      - `text_en` matches `running` ↔ `run`;
      - neutral `text` matches `Häuser` ↔ `hauser`;
      - `uid` exact and prefix match are case-insensitive.
- [x] A path-escape attempt is rejected by the root guard (unit test with a crafted root/id
      combination).
- [x] `./gradlew :server:sf-domain:test` is green.

## Out of scope

- Extracting text from real payloads (`M23.1.2`).
- Wiring to transactions, startup catch-up, the reindex endpoint (`M23.2.*`).
- Query parsing of user input, highlighting, facets in responses, the REST endpoint (`M23.3.1`).
- Locale-specific fields beyond `de`/`en` (`M24.3.3`).

## Notes / hazards

- **Single-instance constraint.** `IndexWriter` takes `write.lock` in the directory. A second app
  instance on the same volume fails to open it. Detect `LockObtainFailedException`, log a clear
  error naming the constraint, and degrade (search returns `503 SF-SEARCH-0503`, writes skip
  indexing) rather than crashing startup. Multi-instance support is out of scope; document it
  (`M23.5.1`).
- Commit user data is the crash-consistency anchor for `M23.2.2`. The revision stamp must be
  written in the **same** Lucene commit as the documents it covers, never in a separate file.
- `ByteBuffersDirectory` is fine for tests, but do not offer `memory` in `application-prod.yml`.
  Validate on startup that prod uses `filesystem`.
- Keep extraction and storage separate: `SearchIndexService` knows nothing about payloads, only
  `SearchDocument`s.
