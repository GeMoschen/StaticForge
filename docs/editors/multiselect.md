# `multiselect`

A multi-choice picker — same `options` shape as [`select`](select.md), but stores an array and
lets the content editor pick more than one. See [README.md](README.md) for attributes common to
every editor type.

**Stored value:** `string[]` (the chosen options' `value`s).

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `options [{ value "…", label "…" }, …]` | the choice list, same shape as `select` |

## Example

```
editor multiselect tags {
  label   "Tags"
  options [
    { value "news",     label "News"     },
    { value "tutorial", label "Tutorial" },
    { value "release",  label "Release"  }
  ]
}
```

## Rendering

Iterate it like any array value:

```
$CMS_IF(tags | size > 0)$
  <ul class="tags">
    $CMS_FOR(tag : tags)$<li>$CMS_VALUE(tag)$</li>$CMS_END_FOR$
  </ul>
$CMS_END_IF$
```
