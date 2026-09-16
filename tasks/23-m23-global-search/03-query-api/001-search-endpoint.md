---
id: M23.3.1
status: todo
depends: [M23.1.2]
epic: m23-global-search
feature: query-api
area: backend
---

# M23.3.1 — `GET /search` (paging, highlights, type facets, safe query parsing)

## Context

- `AssetController.list` (`/api/v1/projects/{projectKey}/assets?type&q&folder&page&size`) is the
  only endpoint following the `docs/api.md` paging convention. It returns Spring `Page<…>`.
- Other list endpoints return plain lists: `RevisionController.list`, `PageController` list, and
  `UrlRegistryService.search`, which is called with `Pageable.unpaged()`.
- Authorization is `@PreAuthorize("@projectAuth.has(#projectKey, ProjectRoleExpr.X)")` via
  `sf-api/.../security/ProjectAuthorizationService` (roles VIEWER, EDITOR, DEVELOPER,
  PROJECT_ADMIN), with the §8.4 `404`-vs-`403` distinction.

## Goals

- **Endpoint.** `SearchController` (sf-api):
  `GET /api/v1/projects/{projectKey}/search?q=&type=&folder=&page=0&size=20`, VIEWER.
  - `q`: required, trimmed, 1–200 chars. Otherwise `400` problem (`SF-SEARCH-0400`).
  - `type`: repeatable (`type=PAGE&type=MEDIA`), validated against `AssetType`.
  - `folder`: folder path prefix, same semantics as `AssetController.list`'s `folder`.
  - `size`: max 100.
  - Sort: relevance only in v1. Reject `sort` other than `relevance` with `400`.
- **Response.**
  - `{content:[SearchHitView], page:{number,size,totalElements,totalPages}, facets:{types:{PAGE:n,
    MEDIA:n,…}}, indexedRevision, latestRevision}`. The envelope matches `docs/api.md`.
  - Facet counts ignore the `type` filter itself (standard drill-sideways), so the UI can show
    counts for the other types.
  - `SearchHitView`:
    - `uuid`, `type`, `uid`, `displayName`, `folderPath`, `score`
    - `matchedIn: TITLE|UID|CONTENT|SOURCE`
    - `snippet`: ≤ 240 chars, highlighted ranges as `[{start,end}]` offsets into plain text, **not
      HTML**, so the UI escapes and marks safely
    - `templateUuid` (nullable)
- **Query construction** (`SearchQueryBuilder`, sf-domain `search` package):
  - Never pass raw user input to the classic `QueryParser` syntax. Tokenize `q` with each field's
    analyzer and build the query programmatically.
  - Boolean SHOULD across:
    - exact `uid` (boost 10)
    - `uid` prefix on the last token (boost 6)
    - `title` phrase (boost 5)
    - `title` terms with a prefix on the last token (boost 4, for quick-open "as you type")
    - `text_de`/`text_en`/`text` terms (boost 1 each, `minimumShouldMatch` = all tokens across the
      text fields)
  - Quoted `"…"` segments become phrase queries.
  - Optional fuzzy (edit distance 1) only for tokens ≥ 5 chars and only when the non-fuzzy query
    returned no hits. That is a second pass, not always-on.
  - Filters (`type`, `folder` prefix) are FILTER clauses and don't score.
- **Highlighting.** Use `UnifiedHighlighter` (or `FastVectorHighlighter` if offsets are indexed)
  on the stored `snippetSource`. Convert its output to plain text + offset ranges server-side.
- **Scope.** The service resolves `projectKey` to `projectId` exactly like other controllers and
  only ever opens that project's index. There is no cross-project search.
- **Errors.**
  - Search state `UNAVAILABLE` (`M23.2.2`): `503` problem `SF-SEARCH-0503` with a
    "search index unavailable" message.
  - `REBUILDING` still serves (the previous index); `lag` is visible through
    `indexedRevision`/`latestRevision`.

## Acceptance criteria

- [ ] API integration tests (`MockMvc`/`TestRestTemplate` like `TargetApiTest`):
      - content-word match;
      - uid exact match ranks above a content-only match;
      - prefix-as-you-type (`tea` finds `teaser`);
      - phrase query;
      - `type` filter plus facet counts with drill-sideways;
      - `folder` prefix filter;
      - paging envelope fields;
      - `size>100` rejected;
      - an empty `q` gives `400`.
- [ ] Adversarial inputs return `200` or `400` and never `500`: `"`, `*`, `?`, `title:foo`,
      `AND OR NOT`, `\`, a 10,000-char string, and an emoji/RTL/combining-character string.
- [ ] Authorization: VIEWER gets `200`, a non-member gets `404`, and an unauthenticated request
      gets `401`. A test with two projects sharing a word shows that each project's search returns
      only its own asset.
- [ ] Snippet offsets are within bounds of `snippet`. The snippet contains no HTML tags even when
      the source value was rich text.
- [ ] `503 SF-SEARCH-0503` when the index is unavailable (test by forcing state).
- [ ] `docs/api.md` endpoint catalogue and Appendix B error catalogue in `cms-specification.md`
      list the endpoint and codes. OpenAPI regenerated; `schema.d.ts` updated.
- [ ] `./gradlew build` green.

## Out of scope

- Cross-project/instance-wide search.
- Searching historical revisions or time-travel-aware search.
- Saved searches, search analytics, "did you mean" spelling suggestions beyond the fuzzy fallback.
- Locale filter/param (`M24.3.3`).

## Notes / hazards

- **Programmatic query building is the security boundary.** Classic `QueryParser` on raw input
  allows expensive queries (leading wildcards, huge `BooleanQuery` expansions → `TooManyClauses`).
  Cap the token count (e.g. 32) and never allow user-controlled wildcards other than the implicit
  last-token prefix. Prefix queries on a single short token (length < 2) are skipped.
- **Result authorization is project-level only** (no per-asset ACLs in v1, §2.2). If per-asset
  ACLs ever arrive, search needs post-filtering. Note it in the spec, don't build it.
- `totalElements` from Lucene is exact up to a threshold (`TotalHits.Relation`). Use
  `TopScoreDocCollectorManager` with a total-hits threshold ≥ 10,000 and expose
  `totalElements` as a lower bound when the relation is `GREATER_THAN_OR_EQUAL_TO` (add
  `totalIsLowerBound` to `page` if needed).
