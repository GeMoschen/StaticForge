# `boolean`

A checkbox/toggle. See [README.md](README.md) for attributes common to every editor type.

**Stored value:** `boolean`.

## Type-specific attributes

None beyond the common set (`default true`/`default false` is the one you'll use most).

## Example

```
editor boolean showCta { label "Show call to action" default false }
```

## Rendering

Use directly as a condition — no comparison operator needed for a bare boolean check:

```
$CMS_IF(showCta && ctaLabel)$
  <a class="button" href="$CMS_REF(relatedPage)$">$CMS_VALUE(ctaLabel)$</a>
$CMS_END_IF$
```

Also commonly used in `visibleWhen` on other editors, e.g. `visibleWhen "showCta == true"` (see
[README.md](README.md)).
