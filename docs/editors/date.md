# `date`

A date picker (no time component). See [README.md](README.md) for attributes common to every
editor type.

**Stored value:** ISO-8601 `string`, date only (e.g. `"2026-08-26"`).

## Type-specific attributes

None currently take effect on the backend: `format "…"` is accepted by the parser (no error) but
its value is parsed and discarded, never carried into the compiled editor definition
(`CdlParser.dispatch`'s `skipValue()` branch) — the stored value is always plain ISO-8601. Use the
`date("pattern")` OCTL filter at render time instead (below) if you need a different display
format.

## Example

```
editor date publishedOn { label "Published on" }
```

## Rendering

```
$CMS_VALUE(publishedOn | date("yyyy-MM-dd"))$
```
