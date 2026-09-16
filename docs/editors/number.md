# `number`

A numeric input. See [README.md](README.md) for attributes common to every editor type.

**Stored value:** `number` (integer or decimal, as entered).

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `min N` | minimum allowed value, blocks publish when violated |
| `max N` | maximum allowed value, blocks publish when violated |

## Example

```
editor number rating {
  label "Rating"
  min   1
  max   5
}
```

## Rendering

`$CMS_VALUE(rating)$` — stringified as-is. The `number("pattern")` filter formats it (e.g.
`$CMS_VALUE(price | number("#,##0.00"))$`).
