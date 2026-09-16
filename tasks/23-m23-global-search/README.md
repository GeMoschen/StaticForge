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

- [ ] Typing a word that only occurs inside a page's rich-text editor value (not its display
      name) in the Ctrl+K palette returns that page within the first results, and Enter opens
      it in the page editor.
- [ ] Search covers, at minimum:
      - pages: display name, uid, content values, section instance content in bodies;
      - media: file name, alt text, caption, copyright;
      - page and section templates: display name, uid, CDL source, OCTL channel sources;
      - navigation page references: label;
      - folders: display name.

      Global property sets (`M17`), processed text media content (`M18`) and dataset records
      (`M19`) are indexed through the same extractor registry.
- [ ] Every mutation reaches the index after its transaction commits, with no request-path
      blocking: create, update, delete, restore, move, UID change, project rollback, import,
      compound revisions. A rolled-back transaction leaves the index unchanged (integration test).
- [ ] After killing the app mid-indexing, or after deleting the index directory, the next start
      brings the index back to the current revision without manual action. The index stores the
      last indexed revision per project and catches up or rebuilds.
- [ ] `POST /api/v1/projects/{projectKey}/search/reindex` (PROJECT_ADMIN) rebuilds one
      project's index without downtime for queries.
- [ ] `GET /search` is project-scoped. A user without membership gets the existing `404`/`403`
      behavior (§8.4), and results never contain assets from another project.
- [ ] German and English queries match inflected forms: `Häuser` finds `Haus`, `running` finds
      `run`. Umlaut-folded input (`haeuser`/`hauser`) still matches through the folded field.
- [ ] Search p95 < 150 ms on the 5,000-page benchmark fixture (`infra/scripts/benchmark-generation.sh`
      data set), and a full project rebuild of that fixture completes in < 60 s. Measured and
      recorded in the benchmark notes.
- [ ] `./gradlew build` (including `checkModuleLayers`) is green; `ui` `npm run build` is
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
