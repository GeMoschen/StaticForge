# `pagination`

Turns one page into a listing that spans several output files: `blog.html`, `blog-2.html`, …,
`blog-N.html`, each showing one slice of an ordered item source. The content editor picks the source
(a Navigation folder or a dataset), the page size and the sort on the page; the template reads the
current slice through `CMS_PAGINATION`. See [README.md](README.md) for attributes common to every
editor type.

**Stored value:** `{type:"PAGINATION", source:{kind:"NAV"|"DATASET", uuid}, pageSize, sort:{key, direction:"ASC"|"DESC"}}`,
or `null` when the page isn't paginated (it then renders once, as any page).

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `sources ["nav", "dataset"]` | the source kinds an editor may pick; default `["nav"]`. Anything else is `SF-CDL-0104` |
| `pageSize N` | the default page size, `1..1000`; default `10` |
| `maxPageSize N` | the largest page size an editor may pick, `pageSize..1000`; default `1000` |
| `sort [...]` | the offered sort keys, the first being the default (see below); default `["navigation"]` |

Where it may be declared (`SF-CDL-0110` otherwise): at the top level of a **page template**'s content
block. Not inside a `list` or `group`, and not in a section template, a global property set or a
dataset schema. A page template holds at most one, counting the one it may inherit from a layout
(`SF-CDL-0111`).

## Sources and order

Both sources end every order with a tiebreak (the item's uid, then the page reference's or record's
uuid), so an item never moves between pages from one build to the next. The direction applies to
the chosen key only.

**Navigation folder (`nav`).** The page references *directly* in the folder, in the order
`$CMS_NAVIGATION` lists them (display name, then uid). Subfolders are not items. A reference is
skipped when:

- it resolves to no page (target deleted, or a folder target without pages): the page still renders
  and the run reports warning `SF-GEN-0412`, unlike `$CMS_NAVIGATION`, which fails the page with
  `SF-GEN-0411`;
- its target page has `nav.visible` set to `false`. `$CMS_NAVIGATION` doesn't read that flag today;
  pagination does, so a page can stay in the menu tree without being listed.

| Key | Order |
|---|---|
| `navigation` | the folder's tree order (`DESC` reverses it) |
| `position` | the target page's `nav.position` |
| `date` | the target page's `nav.date`, else its `publishedOn`; pages without either come last in both directions |
| `displayName` | the target page's display name, case-insensitive |

**Dataset (`dataset`).** The dataset's live records. A sort key is a field the dataset declares with
a natural order (text, number, boolean, date, datetime, select, color) or a record meta field
(`_displayName`, `_uid`, `_changedAt`); the page save checks it against the schema, since a
template's CDL can't know which dataset a page will pick.

## Validation on save

A page save is rejected (`422`, field-addressed issues under `content.<editor>`) when the source kind
isn't in `sources`, the source isn't a live Navigation-store folder or dataset, the page size is
outside `1..maxPageSize`, or the sort key isn't offered (or doesn't fit the source). The source
becomes a `CONTENT_REF` usage of the folder or dataset (source path `content.<editor>.source`).

## Output paths

Page 1 is the page's normal output path, so navigation, `$CMS_REF(page:…)` and bookmarks keep
pointing at it. Pages 2..N sit next to it with `-N` before the extension, in every channel:
`news/blog.html` → `news/blog-2.html`; with pretty URLs `news/blog/index.html` →
`news/blog/index-2.html`. A page template can set a per-channel pattern instead
(**Pagination paths** on the Templates screen, `paginationPath` in the page template API) with `{pageNumber}` (required), `{pagePath}` (page 1's
path without its extension) and the usual placeholders, for example `{pagePath}/page/{pageNumber}/index.{ext}`.
An output that lands on another page's path fails the build with `SF-GEN-0110`, naming the page
number.

## Example

```
editor pagination posts {
  label       "Blog posts"
  sources     ["nav"]
  pageSize    10
  maxPageSize 50
  sort        ["date", "navigation", "displayName"]
}
```

## Rendering

The editor's value isn't rendered directly; every page of a paginated page (and every section,
catalog card and include rendered in it) reads `CMS_PAGINATION`, see
[`../template-developer-guide.md`](../template-developer-guide.md) §2.11:

```
$CMS_FOR(post : CMS_PAGINATION.items)$<a href="$CMS_VALUE(post.href)$">$CMS_VALUE(post.label)$</a>$CMS_END_FOR$
$CMS_IF(CMS_PAGINATION.nextHref)$<a rel="next" href="$CMS_VALUE(CMS_PAGINATION.nextHref)$">Next</a>$CMS_END_IF$
```
