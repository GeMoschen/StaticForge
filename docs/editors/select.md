# `select`

A single-choice dropdown. See [README.md](README.md) for attributes common to every editor type.

**Stored value:** `string` (the chosen option's `value`).

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `options [{ value "…", label "…" }, …]` | the choice list — `value` is what's stored, `label` is shown in the UI |

## Example

```
editor select layout {
  label "Layout"
  options [
    { value "left",  label "Image left"  },
    { value "right", label "Image right" },
    { value "full",  label "Full bleed"  }
  ]
  default "left"
}
```

## Rendering

```
<section class="teaser teaser--$CMS_VALUE(layout)$">
```

Or branch on it explicitly with `$CMS_IF(layout == "full")$…$CMS_END_IF$`.
