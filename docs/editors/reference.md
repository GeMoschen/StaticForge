# `reference`

A picker for another asset (page, folder, etc.), distinct from [`link`](link.md) in that it always
targets an internal asset and can be restricted by type. See [README.md](README.md) for attributes
common to every editor type.

**Stored value:** `{type:"ASSET_REF", uuid, assetType}`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `assetTypes [PAGE, …]` | restricts which asset types can be picked |

`folder "…"` is accepted by the parser (no error) but its value is parsed and discarded, never
carried into the compiled editor definition (`CdlParser.dispatch`'s `skipValue()` branch) — it has
no effect today; the picker isn't scoped to a starting folder by CDL.

## Example

```
editor reference relatedPage { label "Related page" assetTypes [PAGE] }
```

## Rendering

`$CMS_REF$` resolves the referenced asset's URL:

```
<a href="$CMS_REF(relatedPage)$">Read more</a>
```
