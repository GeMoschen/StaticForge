# `json`

An escape hatch for arbitrary structured data with no dedicated editor UI of its own (edited as
raw JSON). See [README.md](README.md) for attributes common to every editor type.

**Stored value:** arbitrary JSON — whatever the content editor enters.

## Type-specific attributes

None beyond the common set.

## Example

```
editor json extra { label "Extra data" }
```

## Rendering

Access sub-fields with dotted paths, same as any object value:

```
$CMS_VALUE(extra.someField)$
```

Prefer a typed editor (`text`, `list`, `group`, …) over `json` whenever the shape is known —
`json` gives up validation (`maxLength`, `required` on sub-fields, etc.) and structure for
flexibility.
