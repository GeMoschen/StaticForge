# `richtext`

A WYSIWYG rich-text field with a configurable toolbar. See [README.md](README.md) for attributes
common to every editor type.

**Stored value:** `{ "format": "html", "value": "…" }`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `features [bold, italic, link, list, h2, h3, quote, …]` | which toolbar/formatting features are enabled |
| `maxChars N` | maximum character count of the plain-text content, blocks publish when violated |

## Example

```
editor richtext body {
  label    "Body text"
  features [bold, italic, link, list, h2, h3, quote]
  maxChars 4000
}
```

## Rendering

The stored `value` is already sanitized HTML — render it with the `raw` filter (it is exempt from
the "raw on plain-text editor" warning, `SF-TPL-0301`, since it isn't plain text):

```
<div class="body">$CMS_VALUE(body | raw)$</div>
```

For a Markdown channel, use the `plain`/`md` filters instead of `raw` to strip or convert the
markup — see `../template-developer-guide.md` §2.4 for a worked Markdown example.
