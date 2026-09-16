# Feature: Global store domain

**Spec:** Extends §3 (asset types), §5.1–§5.4 (asset model, payload, reference
integrity), §10.2 (folder structure per store), §12.3 (CDL migration on rename), §26.5
(export/import).

## Goal

Add `GLOBAL_SET` as a first-class asset type in its own foldered **Globals** store, and
a `GlobalSetService` that creates, updates, deletes and migrates sets under revision
safety. The service reuses the existing CDL compiler, content validation (`M16.5.2`) and
reference materialization (`M16.3`), instead of adding globals-specific variants. Selective
export/import, diff and usages then cover the new type.

Payload shape (one asset, schema and values together):

```json
{
  "contentDefinition": "editor text title { label \"Site title\" required }\n…",
  "compiledDefinition": { "editors": [ … ] },
  "content": { "title": "Acme Outdoor", "logo": {"type":"MEDIA_REF", …} }
}
```

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-global-set-asset-type.md](001-global-set-asset-type.md) | `M16.3.1` |
| 2 | [002-global-set-service.md](002-global-set-service.md) | 1, `M16.5.2`, `M16.1.1` |
| 3 | [003-export-import-diff-usages.md](003-export-import-diff-usages.md) | 2 |

## Feature exit criteria

- [ ] `AssetType.GLOBAL_SET` and `FolderScope.GLOBALS` exist. Every new project gets a
      protected `globals_root` folder inside the single project-creation revision (`M15`),
      and projects that already exist get it lazily, like the other store roots.
- [ ] `GlobalSetService` creates a set, updates its schema (with `renamedFrom` value
      migration in the same revision), updates its values (validated against the
      compiled definition), moves, renames the uid and soft-deletes (blocked while
      referenced). Each operation is one revision.
- [ ] Global sets appear in selective and full-store export/import, in revision diffs, and
      in usages, with no type-specific gaps.

## Dependencies

`M16.3` (references written on save and closed), `M16.5.2` (`ContentValidator` on save),
`M16.1.1` (compiled definition cache), `M15.1` (`RevisionService.beginBatch`/`allocateOrJoin`),
`M13` (protected fixed store roots), `M11` (full-store export).
