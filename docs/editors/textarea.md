# `textarea`

Multi-line plain-text input — same stored shape and attributes as [`text`](text.md), just a
taller form control in the editing UI. See [README.md](README.md) for attributes common to every
editor type.

**Stored value:** `string`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `maxLength N` | maximum character count, enforced on save |

## Example

```
editor textarea excerpt {
  label     "Excerpt"
  maxLength 300
}
```

## Rendering

`$CMS_VALUE(excerpt)$` — plain string, HTML-escaped by default. `nl2br` is a useful filter for
plain-text content that carries line breaks: `$CMS_VALUE(excerpt | nl2br)$`.
