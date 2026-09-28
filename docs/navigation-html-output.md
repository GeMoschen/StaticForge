# `$CMS_NAVIGATION` — HTML output

For **template developers** who need to style or override the markup `$CMS_NAVIGATION` produces.
For the instruction's syntax (`nav:uid`, `depth`, `channel`), see `navigation-template-syntax.md`.
Implementation: `NavigationHtmlRenderer` (`server/sf-domain/.../asset/navigation/`), covered by
golden-file tests in `server/sf-domain/src/test/resources/navigation/render/`.

> Everything below describes what you get from the **leaf form**,
> `$CMS_NAVIGATION(nav:uid [, args])$` (no `as item`). If you want your own markup instead — the
> node data without the fixed `<ul>/<li>` wrapper — see `navigation-template-syntax.md` §5
> (`$CMS_FOR(item : nav:uid)$`, or the block form `$CMS_NAVIGATION(...) as item$ …
> $CMS_END_NAVIGATION$` with `$CMS_NAVIGATION_RECURSE`). Both give you the exact same per-node
> fields (§1 below) as plain values to render however you like.

## 1. Shape

Every rendered node is one of two things:

- A **linked entry** — has a resolved href — renders as `<a href="...">label</a>`.
- A **grouping-only entry** — a folder with no start page — renders as `<span>label</span>`
  instead of an anchor, even when it has children or is a childless leaf.

Both are wrapped in an `<li>`, and any children are recursively wrapped in a nested `<ul>`.

```html
<ul class="nav">
  <li class="nav-item">...</li>
  <li class="nav-item">...</li>
</ul>
```

- The top-level list only appears if the navigation folder has children — an empty folder
  renders as an empty string, not an empty `<ul>`.
- A node with no children renders no nested `<ul>` at all (not an empty one).

## 2. CSS classes

Each `<li>` always carries `nav-item`, plus:

| Class | Meaning |
|---|---|
| `active` | this node's resolved page is the page currently being rendered |
| `trail` | this node is an ancestor of the page currently being rendered (breadcrumb trail) |

A node can be `trail` without being `active` (an ancestor folder), and a leaf node can be
`active` without being `trail`. Neither class is present when there is no "current page" context
(e.g. rendering navigation for something other than a page, or no active page supplied).

## 3. Worked examples

### 3.1 Flat list, one entry active

Input tree — a "Products" folder containing two page references, "Widget" active:

```json
{
  "type": "FOLDER", "label": "Main Navigation", "resolvedPageUuid": null,
  "children": [
    { "type": "FOLDER", "label": "Products", "resolvedPageUuid": null,
      "children": [
        { "type": "PAGE_REFERENCE", "label": "Widget", "resolvedPageUuid": "…201", "children": [] },
        { "type": "PAGE_REFERENCE", "label": "Gadget", "resolvedPageUuid": "…202", "children": [] }
      ]
    }
  ]
}
```

with `…201` as the active page, renders as:

```html
<ul class="nav">
  <li class="nav-item trail">
    <span>Products</span>
    <ul class="nav">
      <li class="nav-item active"><a href="/page/…201/">Widget</a></li>
      <li class="nav-item"><a href="/page/…202/">Gadget</a></li>
    </ul>
  </li>
</ul>
```

("Products" is `trail` because "Widget" — its descendant — is the active page. "Products" itself
is a `<span>`, not a link, because it's a grouping folder with no start page of its own.)

### 3.2 Empty grouping folder

A folder with no start page and no children still renders — as an unlinked, childless entry:

```json
{ "type": "FOLDER", "label": "Main Navigation", "resolvedPageUuid": null,
  "children": [
    { "type": "FOLDER", "label": "Docs", "resolvedPageUuid": null, "children": [] }
  ]
}
```

```html
<ul class="nav"><li class="nav-item"><span>Docs</span></li></ul>
```

### 3.3 Deep nesting with active/trail propagating up multiple levels

`Section > Sub > [Leaf One (active), Leaf Two]`:

```html
<ul class="nav">
  <li class="nav-item trail">
    <span>Section</span>
    <ul class="nav">
      <li class="nav-item trail">
        <span>Sub</span>
        <ul class="nav">
          <li class="nav-item active"><a href="/page/…400/">Leaf One</a></li>
          <li class="nav-item"><a href="/page/…401/">Leaf Two</a></li>
        </ul>
      </li>
    </ul>
  </li>
</ul>
```

Both "Section" and "Sub" pick up `trail` because "Leaf One" is active somewhere in their subtree.

## 4. Escaping and hrefs

- `label` is HTML-escaped (`Filters.escapeHtml`).
- `href` is attribute-escaped (`Filters.escapeAttr`).
- Generated output emits hrefs **relative to the page being rendered**: from `pf/pf1/p3.html`, the
  page `p1.html` is linked as `../../p1.html` and `pf/p2.html` as `../p2.html`, so the site works from
  any host path, `file://` or an unpacked ZIP. The URL registry stores the site path (`pf/p2.html`);
  generation relativizes it per page. A manual registry override that is already absolute (`/…`,
  `https://…`) is emitted unchanged. The same applies to `$CMS_REF` page, folder and media links.
- The site path follows the channel's output settings (`fileExtension`, `settings.urlStrategy`,
  `trailingSlash`, `indexUid`, `indexFileName`). With `urlStrategy: PRETTY` and `trailingSlash: true`,
  `pf/p2.html` is written as `pf/p2/index.html` and linked as `pf/p2/` (from `pf/pf1/p3/index.html`:
  `../../p2/`); the site-root index is linked as `./`. Changing these settings drops the channel's
  computed registry entries (manual overrides stay) and makes the next incremental generation a full one.
- A `PAGE_REFERENCE` node's href is resolved through the URL registry (`UrlRegistryService`,
  `UrlArea.GENERATED`), keyed on the reference's own UUID — stable across regeneration even if
  the target page's slug changes. A `FOLDER` entry-point node (resolved via its `startNode`
  chain) resolves directly via `OutputPathResolver` instead.
  A reference (or `startNode` chain) that ends in a **pages folder** resolves to that folder's index page first —
  its start page, else its page with the channel's `indexUid` (M31, spec §17.2) — before the first navigable page.
  Changing a folder's start page deletes the affected computed registry entries, so they follow at once.
  Because the entry is assigned once, a target page that **moves** keeps being linked at its old path
  until the entry is reset (`POST …/url-registry/reset`) or the channel's output settings change. Since M30
  that link still works: the build records an automatic redirect from the old path (spec §18.9), and the
  quality check `SF-CHK-0109` reports the link so the entry can be reset.
- If a `PAGE_REFERENCE` node's target doesn't resolve to any page at all (deleted target, or an
  empty-subtree folder target), the page's render **fails** with diagnostic `SF-GEN-0411` rather
  than silently emitting the entry as an unlinked `<span>` — a broken nav link is treated as a
  build error, not a degraded render.

## 5. Overriding the markup

The nested-`<ul>` shape above is the **default** renderer (`NavigationHtmlRenderer`), wired
through `BlockResolver#renderNavigation`/`#renderNavigationRecurse`. It is not hard-coded into the
OCTL compiler — a generation/preview pipeline can supply its own `BlockResolver` implementation to
produce different markup (e.g. a different element structure, additional `data-*` attributes) for
the same `$CMS_NAVIGATION(...)$` instruction and tree shape. `renderNavigationRecurse` mirrors the
old `$CMS_NAV_RECURSE$` ergonomics for callers that want to render one node's children at a time.
