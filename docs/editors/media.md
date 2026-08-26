# `media`

A media (image/file) picker. See [README.md](README.md) for attributes common to every editor
type.

**Stored value:** `{type:"MEDIA_REF", uuid, variant?, altOverride?}`.

## Type-specific attributes

| Attribute | Meaning |
|---|---|
| `mimeTypes ["image/jpeg", "image/png", …]` | restricts which media assets can be picked |

`minWidth N` is accepted by the parser (no error) but its value is parsed and discarded, never
carried into the compiled editor definition (`CdlParser.dispatch`'s `skipValue()` branch) — it has
no effect today. Enforce a minimum dimension via the media library's own upload rules instead.

## Example

```
editor media heroImage {
  label      "Hero image"
  mimeTypes  ["image/jpeg", "image/png", "image/webp"]
  required
}
```

## Rendering

`$CMS_REF$` resolves the public path (optionally with a `variant`); `$CMS_VALUE$` reads the
sub-fields (`width`, `height`, `altText`, …):

```
<img src="$CMS_REF(heroImage, variant="w1600")$"
     width="$CMS_VALUE(heroImage.width)$"
     height="$CMS_VALUE(heroImage.height)$"
     alt="$CMS_VALUE(heroImage.altText | attr)$"
     loading="lazy">
```
