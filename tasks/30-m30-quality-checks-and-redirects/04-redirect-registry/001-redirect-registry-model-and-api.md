---
id: M30.4.1
status: todo
depends: []
epic: m30-quality-checks-and-redirects
feature: redirect-registry
area: backend
---

# M30.4.1 — Redirect registry: model, manual API, for-asset

## Context

New package `sf-domain/.../redirect/`, Liquibase `v1.0/027-redirects.xml`, `UrlRegistryController` (roles and
paging style to copy: read `VIEWER`, write `DEVELOPER`), `AuditService` (free-form action strings), M28
`ProjectAuthorizationService.can(projectKey, PublishPermission)`, `TargetWriter.currentRunId()/readManifest(runId)`
and the default target (`GenerationService.resolveTarget`, `:591`), channel output settings (§15.2, `urlStrategy`,
`trailingSlash`). Epic decisions 14, 16, 17, 19.

## Goals

- Table `redirect` (id, project_id, channel_key, locale_key (`''` for non-localized), from_path, to_asset_uuid,
  to_page_number, to_path, kind `AUTO|MANUAL`, created_at, created_by (null for AUTO), source_run_id, updated_at,
  updated_by, version); unique `(project_id, channel_key, locale_key, from_path)`. Exactly one of `to_asset_uuid` /
  `to_path` is set.
- Paths are **output paths** as the manifest stores them (`products/hammer.html`, `de/about/index.html`): normalized,
  no leading `/`, no `..`, no scheme. `to_path` may instead be an absolute `http(s)` URL (manual only).
- `RedirectService`: list (filters `channel`, `locale`, `kind`, `q` on paths, paging), create/update/delete manual,
  `upsertAuto(…)` for detection (`M30.4.2`), `resolve(snapshotView, outputs)` for the build (decision 16: `ACTIVE`,
  `SHADOWED`, `DANGLING`, loop dropped).
- REST `/api/v1/projects/{key}/redirects`: `GET` (`VIEWER`; each row with its current `state` computed against the
  default target's current manifest and the target page's current path), `POST`/`PUT /{id}` (`DEVELOPER`, `If-Match`
  version → `409 SF-API-0409` on mismatch), `DELETE /{id}` (`DEVELOPER`; deleting an AUTO entry is allowed — it comes
  back only if the path changes again). Errors: `SF-DOM-0191` duplicate source, `SF-DOM-0192` loop,
  `SF-DOM-0193` invalid path/URL, `404` unknown id. Audit `REDIRECT_CREATED`, `REDIRECT_UPDATED`, `REDIRECT_DELETED`
  (target `redirect:<channel>/<locale>/<from_path>`).
- `POST /projects/{key}/redirects/for-asset` `{assetUuid, toAssetUuid | toPath}`: one MANUAL entry per current PAGE
  output of the asset in the **default target's current manifest** (every channel, locale, page number; page numbers >
  1 point at page 1 of the target). Allowed with `DEVELOPER` **or** the M28 `RELEASE` permission
  (`@projectAuth.can(#projectKey,'RELEASE')` or `has(…, DEVELOPER)`); `SF-DOM-0194` when the asset has no output there.
  Existing MANUAL entries for those source paths are replaced (it's the explicit user intent), AUTO ones overwritten.
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [ ] CRUD integration tests incl. validation (each `SF-DOM-019x`), `If-Match`, roles (`EDITOR` without `RELEASE` →
      `403` on CRUD and for-asset; with `RELEASE` → for-asset allowed, CRUD still `403`), archived → `409 SF-DOM-0141`.
- [ ] `for-asset` for a localized, paginated page creates the right entries per channel/locale/page number.
- [ ] `state` computation: active, shadowed (source path is a live output), dangling (target not in the manifest).
- [ ] Audit entries for manual changes only.
- [ ] Export/import round trip of the registry (protocol 9), conflict on an existing source path, protocol-8 archive
      imports without redirects.
- [ ] `./gradlew build` green.

## Out of scope

- Detection during builds (`M30.4.2`), output formats (`M30.5.1`), UI (`M30.6.3`).

## Notes / hazards

- Redirects are **not** revisioned assets (like URL registry entries): they aren't part of time travel or project
  restore.
- **Export/import:** the full-project archive carries the registry (`redirects.json`, AUTO and MANUAL, with
  `to_asset_uuid` kept — asset UUIDs survive import, M9); export protocol **9** (M27 moves it to 8). Selective exports
  don't carry redirects. Import into a project that already has a redirect with the same source path reports the
  conflict `REDIRECT_SOURCE_EXISTS` (non-blocking: the archive's entry is skipped). Older archives import without
  redirects. Add these to the acceptance tests below.
- Deleting a page asset leaves its AUTO redirects pointing at it; they become `DANGLING` (not emitted) — that is the
  intended "nothing by default" behaviour; the UI shows them so someone can retarget or delete them.
