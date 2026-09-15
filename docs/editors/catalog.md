# `catalog`

A curated, ordered list of section instances the content editor picks and configures directly on
the page (as opposed to a body's fixed section list) — cards, each backed by one of the allowed
section templates. See [README.md](README.md) for attributes common to every editor type.

**Stored value:** `{type:"CATALOG", cards:[{instanceId, templateRef, content}, …]}`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `allow ["teaser", "cta_box", …]` | section-template **UIDs** a card may be created from (empty/`["*"]` allows any) |
| `min N` | minimum number of cards, blocks publish when violated |
| `max N` | maximum number of cards, blocks publish when violated |

Unlike [`list`](list.md), a `catalog` editor has no `item {}` sub-editor declaration — each card's
fields come from whichever section template it's an instance of, not from CDL declared here.

## Example

```
editor catalog related {
  label "Related cards"
  allow ["teaser", "cta_box"]
  min   0
  max   6
}
```

## Rendering

When `$CMS_VALUE(accessor)$` resolves to a `CATALOG`-typed value, it renders its cards instead of
stringifying the object — each card rendered exactly like a body's section instance
(`BlockResolver#renderCatalog`), so a card's own template may itself declare another `catalog`
editor and recurse:

```
$CMS_VALUE(related)$
```
