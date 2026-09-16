# `text`

Single-line plain-text input. See [README.md](README.md) for attributes common to every editor
type and for grouping/validation.

**Stored value:** `string`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `maxLength N` | maximum character count, blocks publish when violated |

## Example

```
editor text headline {
  label       "Headline"
  help        "Shown as H1. Keep it under 60 characters."
  required
  maxLength   80
  default     "New headline"
}
```

## Rendering

`$CMS_VALUE(headline)$` — a plain string, HTML-escaped by default unless piped through `raw` (not
recommended for plain text — see `SF-TPL-0301`). See `../template-developer-guide.md` Part 2 for
OCTL.
