# `group`

Internally, `EditorType.GROUP` is how the `group "label" { … }` **display wrapper** (see
[README.md](README.md)) is represented once compiled — it groups a set of editors under a section
label in the form UI. It is **transparent**: its children are looked up and rendered by their own
bare name, exactly like top-level editors, not nested under the group's own name.

**Stored value:** none of its own — each child editor stores its value independently, at the
top level of the content JSON, same as if the `group { … }` wrapper weren't there.

## Type-specific attributes

Not applicable — you don't write `editor group name { … }` yourself; you write the wrapper form
instead (below), which the compiler turns into a synthetic `GROUP`-typed entry
(name `_group_N`, excluded from "editor declared but never used" warnings, `SF-TPL-0310`).

## Example

```
group "SEO" {
  editor text metaTitle       { label "Meta title" maxLength 60 }
  editor text metaDescription { label "Meta description" maxLength 160 }
}
```

## Rendering

Reference the child editors by their own name — **not** dotted through the group:

```
$CMS_VALUE(metaTitle)$
$CMS_VALUE(metaDescription)$
```
