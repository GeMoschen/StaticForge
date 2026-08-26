# `$CMS_NAVIGATION` — template syntax

For **template developers** writing OCTL channel templates. Covers the `$CMS_NAVIGATION(...)$`
instruction itself — what you write in a template. For what it actually produces, see
`navigation-html-output.md`. Normative reference: `cms-specification.md` §17.

## 1. Syntax

```
$CMS_NAVIGATION(nav:uid [, depth=N] [, channel=key])$
```

This — the **leaf form** — is a self-closing instruction: unlike `$CMS_IF$`/`$CMS_FOR$`, there is
no matching `$CMS_END_...$`, and it always renders the built-in `<ul>/<li>` markup described in
`navigation-html-output.md`. You can drop it anywhere a normal instruction is valid: in a page
template's channel source, inside a section template rendered via `$CMS_INCLUDE`, etc.

If you want your own markup instead of the built-in list — different HTML per depth, a
`<nav>`/`<details>` structure, extra `data-*` attributes, anything — see §5, which covers two
ways to access nav nodes directly from the template: `$CMS_FOR(item : nav:uid)$` and a **block
form** of `$CMS_NAVIGATION$` with its own recursion instruction.

### 1.1 The reference — `nav:uid`

`nav:uid` names a **navigation folder** asset by its UID, resolved to a UUID at compile time —
exactly like `assetType:uid` in `$CMS_REF`/`$CMS_INCLUDE`/`$CMS_VALUE`. An unresolvable UID is a
compile error (`SF-TPL-0110`).

```
$CMS_NAVIGATION(nav:root)$
```

Navigation folders are plain folders with no template of their own — there's nothing to author on
the folder side beyond building its tree (start nodes, page references, sub-folders). All markup
comes from the renderer described in `navigation-html-output.md`.

### 1.2 `depth` (optional)

Caps how many levels of the tree are walked below the folder's own children.

```
$CMS_NAVIGATION(nav:root, depth=2)$
```

- Absent or not a valid integer → unlimited depth (still hard-capped internally against
  pathological trees/cycles).
- `depth=0` renders nothing (no children walked).
- `depth=1` renders only the folder's immediate children, with no nested `<ul>` for their
  descendants.

### 1.3 `channel` (optional)

Resolves every entry's href against a **different** channel than the one this template is
compiled for. Defaults to the current channel when omitted.

```
$CMS_NAVIGATION(nav:root, channel="markdown")$
```

This is useful when one channel's template wants to link out to another channel's published
pages (e.g. an HTML page linking into a Markdown-only doc set), but in the overwhelming majority
of templates you just omit it and let hrefs resolve in the current channel.

### 1.4 Combining arguments

Arguments are named and can appear in any order, comma-separated:

```
$CMS_NAVIGATION(nav:root, depth=2, channel="markdown")$
```

## 2. Examples

### 2.1 A simple site header (HTML channel)

```html
<header>
  <nav aria-label="Main">
    $CMS_NAVIGATION(nav:root)$
  </nav>
</header>
```

### 2.2 A shallow footer nav, one level deep

```html
<footer>
  $CMS_NAVIGATION(nav:footer, depth=1)$
</footer>
```

### 2.3 Inside a Markdown channel template

```
# $CMS_VALUE(headline)$

$CMS_NAVIGATION(nav:root)$

$CMS_VALUE(body | plain)$
```

(Markdown channels get the same default `<ul>/<li>` HTML fragment unless a custom `BlockResolver`
is wired for that channel — see §3.)

## 3. What decides the markup

`$CMS_NAVIGATION` does not hard-code its own output. The OCTL compiler only parses the
instruction and its arguments (`nav:uid`, `depth`, `channel`) into an `OctlNode.Navigation` node
and resolves the UID at compile time. The actual markup comes from whichever `BlockResolver` is
active for the render — see `navigation-html-output.md` for the shipped default renderer
(`NavigationHtmlRenderer`, a nested `<ul>/<li>` list), and how `active`/`trail` state and hrefs are
computed.

If no `BlockResolver` is configured for a render (e.g. an isolated compile with no generation/
preview context), `$CMS_NAVIGATION` renders as an empty string — the same graceful-degradation
behavior as `$CMS_BODY`/`$CMS_INCLUDE` with no resolver.

## 4. Compile-time and render-time errors

| Situation | Behavior |
|---|---|
| `nav:uid` doesn't resolve to any asset | Compile error `SF-TPL-0110` |
| Block-form `$CMS_NAVIGATION(...) as item$` has no matching `$CMS_END_NAVIGATION$` | Compile error `SF-TPL-0102` |
| `$CMS_NAVIGATION_RECURSE(name)$` where `name` isn't a variable bound by an enclosing `$CMS_NAVIGATION(...) as name$` | Compile error `SF-TPL-0134` |
| Tree contains a start-node cycle | Diagnostic `SF-GEN-0410` (warning); the cycle is truncated and treated as unresolved from that point on |
| Tree contains a dangling `PAGE_REFERENCE` (target deleted, or an empty-subtree folder target) | Render fails with `SF-GEN-0411` (error) — the page's build aborts rather than emitting a broken link |

See `navigation-html-output.md` §4 for what a dangling reference means for the rendered node
itself.

## 5. Accessing nav nodes directly

Both forms below give you the same per-node JSON `NavigationTreeJson` already builds — `label`,
`href`, `active`, `trail`, `type`, `uid`, `assetUuid`, `resolvedPageUuid`, `children[]` — as plain
values you read with `$CMS_VALUE$`/`$CMS_IF$`, instead of the fixed `<ul>/<li>` markup.

### 5.1 `$CMS_FOR(item : nav:uid [, depth=N] [, channel=key])$` — manual per-depth markup

A navigation folder reference works as a `$CMS_FOR$` source, just like iterating a `list` editor.
It yields the folder's **top-level children** as an array; `item.children` is itself an array you
iterate again with another `$CMS_FOR$` for the next depth level:

```
$CMS_FOR(item : nav:root, depth=2)$
  <li class="nav-item$CMS_IF(item.active)$ active$CMS_END_IF$$CMS_IF(item.trail)$ trail$CMS_END_IF$">
    $CMS_IF(item.href)$<a href="$CMS_VALUE(item.href)$">$CMS_VALUE(item.label)$</a>$CMS_ELSE$<span>$CMS_VALUE(item.label)$</span>$CMS_END_IF$
    $CMS_IF(item.children | size > 0)$
      <ul class="nav-sub">
        $CMS_FOR(sub : item.children)$
          <li class="nav-sub-item$CMS_IF(sub.active)$ active$CMS_END_IF$">
            <a href="$CMS_VALUE(sub.href)$">$CMS_VALUE(sub.label)$</a>
          </li>
        $CMS_END_FOR$
      </ul>
    $CMS_END_IF$
  </li>
$CMS_END_FOR$
```

Because each nesting level is its own separately-written `$CMS_FOR$`, "different markup at
different depths" falls out naturally — the top-level `$CMS_FOR$` block and the nested `sub`
block can look completely different. This is the right tool when your nav is a known, shallow
shape (most site navs are 2–3 levels) and you want full control at each level. `depth`/`channel`
on the outer `$CMS_FOR$` behave exactly like `$CMS_NAVIGATION$`'s own named args (§1.2–1.3); they
only matter on the `nav:` accessor itself, not on the nested `item.children` iteration (`_index`,
`_first`, `_last`, `_count` are all available on both loops, same as any other `$CMS_FOR$`).

### 5.2 `$CMS_NAVIGATION(nav:uid [, args]) as item$ … $CMS_END_NAVIGATION$` — one recursive template

For a tree of unknown/arbitrary depth where you want **one** template applied at every level
instead of manually nesting `$CMS_FOR$`, use the block form plus `$CMS_NAVIGATION_RECURSE`:

```
$CMS_NAVIGATION(nav:root, depth=3) as item$
  <li class="nav-item depth-$CMS_VALUE(item._depth)$$CMS_IF(item.active)$ active$CMS_END_IF$">
    $CMS_IF(item.href)$<a href="$CMS_VALUE(item.href)$">$CMS_VALUE(item.label)$</a>$CMS_ELSE$<span>$CMS_VALUE(item.label)$</span>$CMS_END_IF$
    $CMS_IF(item.children | size > 0)$
      <ul>$CMS_NAVIGATION_RECURSE(item)$</ul>
    $CMS_END_IF$
  </li>
$CMS_END_NAVIGATION$
```

- `as item` binds the loop variable, exactly like `$CMS_FOR(item : ...)$`; the body between
  `$CMS_NAVIGATION(...)$` and `$CMS_END_NAVIGATION$` runs once per top-level child.
- `item._depth` is `0` at the top level, and increments by one every time
  `$CMS_NAVIGATION_RECURSE(item)$` descends — so you can still branch on depth inside the one
  shared body (e.g. `$CMS_IF(item._depth == 0)$…$CMS_ELSE$…$CMS_END_IF$`) when a couple of levels
  need genuinely different markup, without writing out every level by hand.
- `$CMS_NAVIGATION_RECURSE(item)$` is only valid inside the body of the `$CMS_NAVIGATION(...) as
  item$` block it names — it renders `item`'s children using that same body, one level deeper. It
  needs no `BlockResolver` round-trip: the children are already present in the JSON fetched once
  up front (bounded by the `depth` you passed).
- Omitting `as item` (no body, no `$CMS_END_NAVIGATION$`) is the original leaf form from §1 —
  completely unaffected by any of this.

Pick §5.1 when the shape is fixed and shallow and you want to author each level explicitly; pick
§5.2 when the depth varies and you'd rather write the per-node markup once.
