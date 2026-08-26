# `markdown`

A plain-text field authored as Markdown source (no WYSIWYG toolbar — content editors write
Markdown syntax directly). See [README.md](README.md) for attributes common to every editor type.

**Stored value:** `string` (raw Markdown source, not HTML).

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `maxChars N` | maximum character count, enforced on save |

## Example

```
editor markdown notes {
  label    "Internal notes"
  maxChars 2000
}
```

## Rendering

Use the `md` filter to convert to HTML in an HTML channel, or emit as-is in a Markdown channel:

```
<div class="notes">$CMS_VALUE(notes | md)$</div>
```
