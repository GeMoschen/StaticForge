# `link`

A link picker — an internal asset reference or an external URL, with optional anchor/target/title.
See [README.md](README.md) for attributes common to every editor type.

**Stored value:** `{kind, uuid?, url?, anchor?, target?, title?}`.

## Type-specific attributes

None beyond the common set — a `link` editor's picker itself offers the internal-vs-external
choice; there is no CDL attribute to restrict which asset types it may target (contrast with
[`reference`](reference.md), which does have `assetTypes`).

## Example

```
editor link target { label "Target" }
```

## Rendering

Use `$CMS_REF$` to resolve it to a URL:

```
<a href="$CMS_REF(target)$">$CMS_VALUE(target.title)$</a>
```
