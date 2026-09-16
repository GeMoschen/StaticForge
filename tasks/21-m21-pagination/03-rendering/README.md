# Feature: `$CMS_PAGINATION` render scope (generation + preview)

**Spec:** Extends §16.5 (scopes), §16.2 (instructions, `$CMS_META`), §19 (preview modes and
mechanics), §25.4 (golden-file tests).

## Goal

Every render of a paginated plan entry exposes a read-only `CMS_PAGINATION` root to OCTL. It
works the way `CMS_PAGE` does today in `OctlRenderer.resolve`, and holds the current slice of
items plus navigation data:

| Accessor | Meaning |
|---|---|
| `CMS_PAGINATION.items` | array of items on this page (nav: `{uuid, uid, displayName, label, href, date, …target page content}`; dataset: record content + `uid`/`uuid`) |
| `CMS_PAGINATION.current` / `.total` | 1-based page number / page count |
| `CMS_PAGINATION.pageSize` / `.itemCount` | configured size / total eligible items |
| `CMS_PAGINATION.firstHref` / `.prevHref` / `.nextHref` / `.lastHref` | relative hrefs; `prev`/`next` empty on first/last page |
| `CMS_PAGINATION.canonicalHref` | this page's own relative href |
| `CMS_PAGINATION.pages` | array of `{number, href, current}` for numbered page links |

Non-paginated pages see `CMS_PAGINATION` as missing (so `$CMS_IF(CMS_PAGINATION)$` is false).

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-pagination-scope.md](001-pagination-scope.md) | `M21.2.1`, `M21.2.2`, `M16.1.1`, `M16.2.2` |

## Feature exit criteria

- [x] Generation renders each paginated entry with the correct slice and hrefs.
- [x] Preview renders page `n` via `?page=n` (clamped to `1..total`), with links between preview
      pages working in rewrite-links mode.
- [x] The OCTL compiler accepts `CMS_PAGINATION.*` accessors without `SF-TPL-0103`.
- [x] Golden-file tests (`server/sf-template/src/test/resources/render/pagination-*`) cover first,
      middle, last, single and empty pages.

## Dependencies

`M21.2.1` (plan entries carry `Pagination` + resolved item list), `M21.2.2` (canonical/prev/next
data), `M16.1.1` (compile cache: N renders of one template must not recompile N times),
`M16.2.2` (cross-asset value resolution; item fields of target pages / records are read through
it), `M19.3.2` (dataset items; dataset branch only).
