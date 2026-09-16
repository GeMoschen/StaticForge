# Feature: Query API

**Spec:** Extends §20.2 (endpoint catalogue) with a project-scoped search endpoint following §20.1
conventions (`docs/api.md`: `?page=0&size=50&sort=…`, envelope `{content:[…], page:{…}}`,
RFC 9457 problems) and §8.4 authorization.

## Goal

Expose the index through one read-only endpoint, `GET /api/v1/projects/{projectKey}/search`. It
must be safe against arbitrary user input: no Lucene syntax errors surface as `500`, and no query
can reach another project's index. Relevance should work well for both quick-open (title/uid
first) and content search (text matches with snippets). Responses include type facet counts so the
UI can filter.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-search-endpoint.md](001-search-endpoint.md) | M23.1.2 |

## Feature exit criteria

- [ ] `GET /search` returns paged, ranked hits with snippets and type facets, VIEWER-authorized, and
      is documented in `docs/api.md` and the OpenAPI schema.
- [ ] Malformed or adversarial input (unbalanced quotes, `*` alone, `field:` syntax, very long
      strings) yields a `200` with sensible results or a `400` problem, never a `500`.

## Dependencies

`M23.1.*` (index + extraction). It does not depend on `M23.2.*` to be built, but it is only
meaningful once lifecycle keeps the index current.
