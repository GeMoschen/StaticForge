# `list`

A repeatable group of sub-editors — the "repeater" editor. See [README.md](README.md) for
attributes common to every editor type.

**Stored value:** an array, one object per item, keyed by each `item {}` sub-editor's name.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `min N` | minimum number of items, enforced on save |
| `max N` | maximum number of items, enforced on save |
| `item { editor … editor … }` | the sub-editors each item is made of — **required**; `item` on any other editor type is a compile error |

Each `list` item opens its own name-uniqueness namespace: a sub-editor name inside `item {}` can
reuse a name already used elsewhere in the template without colliding.

## Example

```
editor list links {
  label "Link list"
  min 0
  max 8
  item {
    editor text label  { label "Link text" required }
    editor link target { label "Target" }
  }
}
```

## Rendering

Iterate with `$CMS_FOR$`; loop scope exposes `item.<subEditor>` plus `item._index`, `item._first`,
`item._last`, `item._count`:

```
$CMS_IF(links | size > 0)$
  <ul class="links">
    $CMS_FOR(link : links)$
      <li class="link$CMS_IF(link._first)$ is-first$CMS_END_IF$">
        <a href="$CMS_REF(link.target)$">$CMS_VALUE(link.label)$</a>
      </li>
    $CMS_END_FOR$
  </ul>
$CMS_END_IF$
```
