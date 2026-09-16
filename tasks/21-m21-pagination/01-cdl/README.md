# Feature: Pagination editor type (CDL)

**Spec:** Extends §14.3 (editor types), §14.4 (common attributes), §14.7 (compiler);
editor reference in `docs/editors/`.

## Goal

Add `pagination` as the 19th CDL editor type (`EditorType`, `CdlValidator` type map,
`EditorDefinition`), with a stored value shape that fully describes the slice source.
It must be restricted to page templates (at most one per template) and validated both in CDL
and on page save (`M16.5.2`'s server-side `ContentValidator`).

Declaration:

```
editor pagination posts {
  label    "Blog posts"
  sources  ["nav", "dataset"]          // allowed source kinds; default ["nav"]
  pageSize 10                          // default page size
  maxPageSize 50                       // optional upper bound for the editor-picked size
  sort     ["navigation", "date", "displayName"]   // offered sort keys; first is default
}
```

Stored value:

```json
{ "type": "PAGINATION",
  "source": { "kind": "NAV", "uuid": "…" },
  "pageSize": 10,
  "sort": { "key": "date", "direction": "DESC" } }
```

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-pagination-editor-type.md](001-pagination-editor-type.md) | `M16.5.2`, `M16.3.1` |

## Feature exit criteria

- [x] `EditorType.PAGINATION` exists, parses, compiles into `EditorDefinition`, and is rejected
      in section templates and when declared twice in one page template.
- [x] The stored `PAGINATION` value is validated on page save (source kind allowed, source asset
      exists with the right type/scope, `1 ≤ pageSize ≤ maxPageSize`, sort key offered).
- [x] The source asset is materialized as a `CONTENT_REF` reference from the page (usages view
      shows the page under the nav folder / dataset).
- [x] `docs/editors/pagination.md` exists and `docs/editors/README.md` lists 19 types.

## Dependencies

`M16.5.2` (server-side `ContentValidator` on save; without it the stored value is never
validated), `M16.3.1` (content references written on save; the source edge must exist before
planning relies on it).
