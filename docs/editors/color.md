# `color`

A color picker. See [README.md](README.md) for attributes common to every editor type.

**Stored value:** `#rrggbb` string.

## Type-specific attributes

None beyond the common set.

## Example

```
editor color accentColor { label "Accent color" default "#0066cc" }
```

## Rendering

Use directly in an inline style or a CSS custom property:

```
<section style="--accent: $CMS_VALUE(accentColor | attr)$">
```
