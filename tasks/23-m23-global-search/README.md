# M23 — Global search

**Spec:** New capability, not in the original §27 roadmap. It is added the same way `M8`–`M22`
were. It touches §20 (REST API: a new `/search` endpoint that follows §20.1 paging), §21.4
(transactions: indexing runs after commit, outside the revision transaction), §23/§24 (the Ctrl+K
command palette, currently a stub, becomes functional) and §26.1/§26.2 (performance and
scalability: embedded index constraints). It is distinct from `SearchIndexPostProcessor` (§18,
Q3), which writes a *public site* search index at generation time. M23 builds an *editorial*
search across the CMS's own assets.

## Goal

Today the only way to find something is to already know where it lives:

- `GET /assets?q=` (`AssetController.list` → `AssetServiceImpl.search` →
  `AssetVersionRepository.search`) is a JPQL `LIKE` on `displayName` only.
- `PageController` list `?q=` filters display names in memory, unpaged.
- The media library has its own debounced display-name filter.
- No endpoint looks inside content values, rich text, CDL/OCTL template source, media metadata
  (alt text, caption, copyright) or navigation labels.
- `core/ui/command-palette/command-palette.component.ts` is mounted and opened by Ctrl/Cmd+K
  (`core/ui/shortcut.service.ts`), but it is an input with no logic.

This milestone adds project-scoped full-text search over **every current asset** of a project,
backed by an **embedded Apache Lucene index** (user decision 2026-09-15; DB full-text and an
external engine were rejected):

- **Index core.** Index core: one Lucene index directory per project under a configurable root
  (`sf.search.index-root`). The document model has identity/facet fields plus analyzed text fields
  (German + English stemming alongside a language-neutral folded field). A pluggable per-asset-type
  text extractor turns payloads into searchable text.
- **Index lifecycle.** Index lifecycle: the index is kept current **after commit** from each
  revision's `summary.assets` list, so a rolled-back transaction never reaches the index. It is
  stamped with the last indexed revision so a crash or restart catches up from the revision log
  instead of drifting. It can always be rebuilt from the database, which stays the source of truth.
- **Query API.** Query API: `GET /api/v1/projects/{projectKey}/search`, VIEWER-authorized, paged
  per `docs/api.md`, with type facets, highlighted snippets, and safe parsing of user input.
- **UI.** UI: the Ctrl+K command palette becomes a real quick-open over search results, plus a full
  search page with facets and filters.

Search always reflects the **current** revision. Time travel does not change what search returns
(see Notes).

## Exit criteria (epic is done when)

- [x] Typing a word that only occurs inside a page's rich-text editor value (not its display
      name) in the Ctrl+K palette returns that page within the first results, and Enter opens
      it in the page editor.
- [x] Search covers, at minimum:
      - pages: display name, uid, content values, section instance content in bodies;
      - media: file name, alt text, caption, copyright;
      - page and section templates: display name, uid, CDL source, OCTL channel sources;
      - navigation page references: label;
      - folders: display name.

      Global property sets (`M17`), processed text media content (`M18`) and dataset records
      (`M19`) are indexed through the same extractor registry.
- [x] Every mutation reaches the index after its transaction commits, with no request-path
      blocking: create, update, delete, restore, move, UID change, project rollback, import,
      compound revisions. A rolled-back transaction leaves the index unchanged (integration test).
- [x] After killing the app mid-indexing, or after deleting the index directory, the next start
      brings the index back to the current revision without manual action. The index stores the
      last indexed revision per project and catches up or rebuilds.
- [x] `POST /api/v1/projects/{projectKey}/search/reindex` (PROJECT_ADMIN) rebuilds one
      project's index without downtime for queries.
- [x] `GET /search` is project-scoped. A user without membership gets the existing `404`/`403`
      behavior (§8.4), and results never contain assets from another project.
- [x] German and English queries match inflected forms: `Häuser` finds `Haus`, `running` finds
      `run`. Umlaut-folded input (`haeuser`/`hauser`) still matches through the folded field.
- [x] Search p95 < 150 ms on the 5,000-page benchmark fixture (`infra/scripts/benchmark-generation.sh`
      data set), and a full project rebuild of that fixture completes in < 60 s. Measured and
      recorded in the benchmark notes.
- [x] `./gradlew build` (including `checkModuleLayers`) is green; `ui` `npm run build` is
      green. `npm test` has no new failures beyond the known `templateUrl` spec issue.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [index-core](01-index-core/README.md) | backend | — |
| 2 | [index-lifecycle](02-index-lifecycle/README.md) | backend | 1 |
| 3 | [query-api](03-query-api/README.md) | backend | 1 |
| 4 | [ui](04-ui/README.md) | frontend | 3 |
| 5 | [docs-e2e](05-docs-e2e/README.md) | qa | 2, 3, 4 |

## Dependencies

- `M15` (compound revisions): after it, `summary.assets` lists *every* asset a revision touched,
  including restore and project creation. That makes it a reliable change feed for incremental
  indexing.
- `M16` (foundations): `M16.1.1`'s compiled definition cache lets extraction read a template's
  `ContentDefinition` without recompiling CDL per page. `M16.5.2` provides validated content
  shapes.
- `M17`/`M18`/`M19`: the global-set, processed text media and record asset types that the
  extractor registry covers.
- `M24.3.3` later makes the index locale-aware. This epic keeps the document model open for it
  (see Notes).

## Notes

- **Database stays the source of truth.** The Lucene index is a derived, disposable cache. Every
  design choice must keep "delete the index directory and restart" a safe, fully recovering
  operation. Nothing in the domain may read the index to make a write decision.
- **Single-instance constraint.** The index lives on local disk of the app node, and Lucene allows
  one `IndexWriter` per directory, guarded by `write.lock`. The v1 deployment
  (`infra/docker/docker-compose.yml`) runs one app container, so this is acceptable. Running two
  or more app instances would need either per-node indexes, each catching up independently from
  the revision log (feasible with the revision stamp), or a shared/replicated index store. **Both
  are out of scope.** Document this in `infra/README.md` and the deploy runbook as a scaling
  limit, next to Q4-style constraints.
- **Time travel.** The index holds only the current revision. While `TimeTravelStore` is active,
  the palette and search page still search "now". The UI must say so ("Results reflect the
  current revision") and opening a result exits time travel, or at least makes that visible.
  Indexing historical revisions is out of scope.
- **Module placement.** `checkModuleLayers` (root `build.gradle.kts`) allows
  `sf-domain → {sf-common, sf-template}` and `sf-api → {…, sf-domain, …}`. Index, extraction and
  lifecycle live in `sf-domain`, in a new package `com.acme.staticforge.search`, because indexing
  hooks the domain transaction and reads domain repositories and the blob store. The controller
  and DTOs live in `sf-api`. Lucene dependencies are declared only on `sf-domain`.
- **Versioning.** Lucene artifacts (`lucene-core`, `lucene-analysis-common`, `lucene-queryparser`,
  `lucene-highlighter`) are added to `gradle/libs.versions.toml` under one pinned
  `lucene` version ref. They are not managed by the Spring Boot BOM, so pin them explicitly.
- **Docker.** A new `SF_SEARCH_INDEX_ROOT` env and a `search-index` named volume, alongside
  `media-data`/`output-data`. The volume is optional because the index is rebuildable, but it
  avoids a full rebuild on every container restart.
- **Projects are archived, not deleted.** `ProjectService.archive` is the only lifecycle end today.
  Archiving closes the project's index. Removing index files is tied to a future hard delete, not
  assumed here.
- `M24.3.3` will add locale-aware fields. Keep field naming extensible (`text`, `text_de`,
  `text_en`) so a per-locale `text_<locale>` scheme drops in without a document-model rewrite.

## Implementation notes (2026-09-17)

Evidence and deviations; the code is the source of truth where they differ from the task files.

- **Evidence for the exit criteria.**
  - Rich-text word → palette → Enter opens the editor: `ui/e2e/m23-journeys.spec.ts` "find and fix", live against the
    dev backend and `ng serve`. It also replaces the word in the editor and checks that the old word no longer
    matches and the new one does.
  - Coverage per type: `SearchTextExtractorsTest` (12: rich text, nested list in a catalog card, sections and meta,
    skipped value types, stale editors and missing templates, media metadata and processed text, template CDL/OCTL as
    code, dataset, page reference label, store roots, global set and record values, text cap).
  - Mutation paths: `SearchIndexingIntegrationTest` covers create, update, soft delete, restore, UID change, project
    creation, project rollback, import, media metadata, a section-template CDL change, channel seeding
    (`ChannelServiceImpl`), a template rename cascade (`renamedFrom`), page and folder moves, a rolled-back
    transaction, a compound revision (one event), a slow extractor (the save returns first) and archiving.
  - Crash recovery: `SearchIndexRecoveryIntegrationTest` (filesystem index, live indexing off) covers the startup
    catch-up of missed revisions, a deleted index directory, an outdated schema version, an index of another database,
    and a locked directory (`UNAVAILABLE`, `503`, health `UP` with `search: DEGRADED`).
  - Reindex without downtime, project scope and authorization: `SearchApiTest` (11). One test holds a rebuild in
    extraction: queries keep answering from the old index, a second reindex returns `409`, and after the swap the edit
    made during the rebuild is searchable.
  - Language: `SearchAnalyzersTest` (`Häuser`↔`Haus`, `running`↔`run`, `haeuser`/`hauser`, uid exact and prefix
    ignoring case).
  - Benchmark (5,000 pages, `SearchBenchmark`, `infra/scripts/README-benchmark.md`): full rebuild 1.6 s, query p50
    19.5 ms, p95 34.6 ms; the index settles 232 ms after a burst of 100 saves.
- **One sync path instead of per-revision application (M23.2.1/M23.2.2).** The after-commit listener doesn't apply its
  own revision. It asks `SearchIndexer` to sync the project, and a sync always replays from the index's stamp to the
  database's newest revision, or rebuilds first. Live indexing, startup catch-up, reindex and the catch-up after a swap
  are therefore the same code. The gapless rule falls out of it: the stamp only advances over contiguous revisions
  without failed assets. Syncs are serial and coalesced per project (at most one pending), which bounds the queue
  without dropping work.
- **Touched assets = `summary.assets` ∪ assets with a version opened in the replayed range.** A UID change writes no
  version (M22 found this) and a folder move changes descendants that aren't in the summary; the union covers both.
- **Cascades only on a definition change.** Dependents of a template or dataset (reverse `TEMPLATE` edges, catalog-card
  `CONTENT_REF …templateRef`, transitively through child page templates) are re-extracted when its CDL, parent or
  deleted state differs from its version at the stamp. An OCTL-only edit doesn't re-extract 5,000 pages. Compile
  caches are keyed by template version, so nothing needs invalidating.
- **Owner token (addition).** Commit data also stores the project key and creation time. A leftover index of another
  database (the dev profile's in-memory H2 with the default filesystem index, or a restored dump) is rebuilt instead
  of trusted. This happened in the live run after a backend restart ("index belongs to another database").
- **Code in its own field.** CDL, OCTL and processed text media go to a neutral-analyzed `source` field, not `text`.
  They still get no German/English stemming, and `matchedIn: SOURCE` is exact.
- **Lock detection.** Besides a failed writer open, `check()` probes an unopened directory's `write.lock` (inside the
  open-map compute, so it never races this instance's own open). A locked project is `UNAVAILABLE` before a rebuild
  could try to move a directory another process holds.
- **Errors.** `SF-SEARCH-0409` for a concurrent reindex; the task said it "mirrors `SF-GEN-0500`", and a search code
  keeps the catalogue by feature. `totalIsLowerBound` is always `false`: type counts come from a collector over every
  match, so totals are exact.
- **HTML → text.** `HtmlText` (sf-common) is shared with the OCTL `plain` filter. Inline formatting tags no longer
  become spaces (`<b>Ha</b>us` → `Haus`, "a quokka." instead of "a quokka ."), and numeric character references are
  decoded. Golden render tests are unchanged.
- **Lucene `queryparser` isn't used.** Queries are built programmatically (never `QueryParser`), so the dependency was
  dropped again. sf-app declares `lucene-core` as `testImplementation` only: the recovery test forges outdated commits.
- **UI.**
  - The palette and search page share `shared/asset-route.util.ts`. The `?asset=`/`?folder=` deep links are applied
    once their data has loaded and then removed (`shared/deep-link.ts`), so the same link works again after the user
    selects something else.
  - Folders open in their own store (pages, media, navigation, templates, globals, content), chosen by the first
    segment of the folder path.
  - The folder filter is a path input with suggestions from every store's tree; there is no type-agnostic folder
    picker.
  - `SKIP_ERROR_TOAST` (`HttpContextToken`) lets search show `503` inline instead of the global toast.
  - Pressing Search with an unchanged query re-runs it: the router ignores same-URL navigation (found in the live
    journey).
- **Found and fixed during live verification:** the same-query re-run above; "1 results" in the palette footer; a
  misleading "No results" while the index lags (it now says the index is catching up); inline tags splitting words.
- **Not verified here:** `docker compose config` (Docker isn't installed; the YAML was checked with PyYAML), axe (not
  installed), and component specs for the palette and search page (the local runner can't mount `templateUrl`
  components; their logic is in `search.util.spec.ts`, `search.service.spec.ts` and `asset-route.util.spec.ts`, and
  the four live journeys cover the components).
- **Not built (out of scope as written):** summary compaction (§7.7) doesn't exist, so the "fall back to a rebuild for a
  compacted revision" hazard has no flag to read; if compaction lands, `SearchIndexer.replay` must check it.
