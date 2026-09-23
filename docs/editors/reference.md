# `reference`

A picker for another asset (page, folder, record, record set, etc.), distinct from [`link`](link.md) in that it always
targets an internal asset and can be restricted by type. See [README.md](README.md) for attributes
common to every editor type.

**Stored value:** `{type:"ASSET_REF", uuid, assetType}`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `assetTypes [PAGE, …]` | restricts which asset types can be picked (`RECORD` for dataset records, M19; `RECORD_SET` for record sets, M25) |
| `dataset "uid"` | restricts the editor to one dataset (M19): to its records, and — when `assetTypes` names `RECORD_SET` — to its record sets (M25). The picker lists only those, and a saved value pointing anywhere else (another dataset's record or set, or another type) is an `ERROR` finding (code `dataset`). Without `assetTypes`, or with `assetTypes [RECORD]`, only records are allowed; `[RECORD_SET]` allows only sets, `[RECORD, RECORD_SET]` both. Valid only on `reference` (`SF-CDL-0104` otherwise); if `assetTypes` is given it must include `RECORD` or `RECORD_SET` |

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

### Record sets (M25)

An editor that picks a **record set** hands the page a list an editor curated — "the leadership
team" — with the set's own query deciding which records show and in which order:

<!-- golden: render/recordset-reference-editor/template.cdl -->
```
content {
  editor reference featured { label "Featured" assetTypes [RECORD_SET] dataset "team" }
  editor reference unrestricted { label "Any set" assetTypes [RECORD_SET] }
  editor reference empty { label "Empty" assetTypes [RECORD_SET] }
  editor reference person { label "Person" dataset "team" }
}
```

`featured` accepts only sets of dataset `team`; `unrestricted` any set; `person` only records of
`team`. The value is stored like any reference (`assetType: "RECORD_SET"`) and renders exactly like
`recordset:<uid>` ([template developer guide §2.9, Rendering a set](../template-developer-guide.md#rendering-a-set-m25)):

<!-- golden: render/recordset-reference-editor/template.octl -->
```
<section>$CMS_VALUE(featured)$</section>
<p>$CMS_VALUE(featured._count)$ in $CMS_VALUE(featured._meta.displayName)$ ($CMS_VALUE(featured.assetType)$)</p>
<ul>$CMS_FOR(m : featured, sort="name", limit=1)$<li>$CMS_VALUE(m.name)$ $CMS_VALUE(m._index)$/$CMS_VALUE(m._count)$</li>$CMS_END_FOR$</ul>
<p>$CMS_FOR(m : featured.records)$[$CMS_VALUE(m._uid)$]$CMS_END_FOR$</p>
<p>$CMS_FOR(m : unrestricted, where="m.nope == 1")$never$CMS_END_FOR$|$CMS_FOR(m : unrestricted, where="m.role == 'dev'", sort="-joined")$[$CMS_VALUE(m._uid)$]$CMS_END_FOR$</p>
<ul>$CMS_VALUE(unrestricted)$</ul>
<p>[$CMS_VALUE(empty)$][$CMS_VALUE(empty._count)$][$CMS_VALUE(person.name)$]</p>
```

- `$CMS_VALUE(featured)$` renders the set's selected records, each through the dataset's record
  template for the channel (nothing, with `SF-GEN-0241`, when the dataset has none for it).
- `featured._count`, `featured.records` and `featured._meta.uid` / `.displayName` / `.dataset` read
  the set's root value object; `featured.uuid` and `featured.assetType` stay the stored value's.
- `$CMS_FOR(m : featured, where=…, sort=…, limit=…, offset=…)$` loops the set's selected records and
  narrows them (`folder` is `SF-TPL-0140`). With `dataset "team"` the loop's fields are checked when
  the template is saved; without it, a field the referenced set's dataset lacks warns `SF-TPL-0141`
  when the page renders and reads as missing.
- A deleted set renders empty (`SF-TPL-0112`). A set has no URL of its own (`$CMS_REF(recordset:uid)$` is
  `SF-TPL-0105`).

The page rebuilds when the set changes, or when a record the set's query selects (before or after the
change) changes — see the developer guide's *Incremental builds with record sets*. In the page editor the
picker's **Record sets** type lists the sets with their dataset and record count.
