---
id: M1.5.1
status: done
depends: [M1.3.1, M1.4.3]
epic: m1-identity-revisions
feature: asset-api
area: backend
---

# M1.5.1 — Generic asset API

## Context

Implement the generic Assets operations of §20.2 shared by every asset type, wired to
the revision machinery.

## Goals

- Implement `GET /assets` (cross-type list/search, `?type=`, `?q=`, `?folder=`),
  `GET /assets/{uuid}` (type-polymorphic representation), `GET /assets/{uuid}/usages`
  (inbound refs — stub until `asset_reference`), `/history`, `/versions/{revision}`,
  `POST /{uuid}/restore` (`{fromRevision}`), `PATCH /{uuid}/uid`, `POST /{uuid}/move`,
  `DELETE /{uuid}` (soft, `?force=`).
- Apply §20.1 conventions: pagination envelope, `?fields=` partials, `ETag`.
- Route through `AssetService` (§21.3 contract) with `CreateAssetCommand`/etc.

## Acceptance criteria

- [ ] List/search respects `project_id` isolation and returns the §20.3 payload shape
      (with `_links`).
- [ ] Soft delete sets `deleted=true`; `force` bypasses the usage warning.
- [ ] Every mutation allocates a revision.

## Out of scope

- `usages` requires `asset_reference` (M2) — return empty/stub until then.
- Page/folder-specific logic (next two tasks).

## Notes / hazards

- Keep controllers thin (§21.2); `AssetService` holds transactions.
