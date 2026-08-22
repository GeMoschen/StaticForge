# Feature: Asset, Folder & Page API

**Spec:** §20.2 (Assets, Folders, Pages), §10 (Page type + folders).
**Area:** backend. **Epic:** M1.

## Goal

Expose the generic asset operations plus the first concrete asset types (folder, page)
over the REST API, all revision-aware.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-generic-asset-api.md](001-generic-asset-api.md) | M1.3.1, M1.4.3 |
| 2 | [002-folder-service-api.md](002-folder-service-api.md) | 1 |
| 3 | [003-page-service-api.md](003-page-service-api.md) | 1 |

## Feature exit criteria

- [ ] Generic asset list/search/get/history/versions/move/delete and UID change work.
- [ ] Folder tree builds with materialized paths; subtree move rewrites paths (§10.2).
- [ ] Page create/edit/reorder/delete is revision-aware and CDL-validated (CDL lands M2;
      structural checks + `templateRef` resolution here).

## Dependencies

`M1:asset-identity`, `M1:revision`, `M1:project-domain`.
