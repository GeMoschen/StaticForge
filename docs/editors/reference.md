# `reference`

A picker for another asset (page, folder, record, etc.), distinct from [`link`](link.md) in that it always
targets an internal asset and can be restricted by type. See [README.md](README.md) for attributes
common to every editor type.

**Stored value:** `{type:"ASSET_REF", uuid, assetType}`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `assetTypes [PAGE, …]` | restricts which asset types can be picked (`RECORD` for dataset records, M19) |
| `dataset "uid"` | restricts the editor to the records of one dataset (M19): the picker lists only that dataset's records, and a saved value pointing anywhere else is an `ERROR` finding (code `dataset`). Valid only on `reference` (`SF-CDL-0104` otherwise); if `assetTypes` is given it must include `RECORD` |

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

A reference to a **record** has no URL; walk into it instead — any path segment the stored value
itself lacks reads the referenced record ([template developer guide §2.9](../template-developer-guide.md)):

```
editor reference author { label "Author" dataset "team" }
```

```
<p>By $CMS_VALUE(author.name)$ ($CMS_VALUE(author.role)$)</p>
<a href="$CMS_REF(author.website)$">Website</a>
```

`author.uuid` and `author.assetType` stay the stored value's own fields. References through records
chain (`author.mentor.name`); a deleted or missing record renders empty. The page depends on that
one record only, so editing it (not its siblings) rebuilds the page.
