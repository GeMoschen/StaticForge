---
id: M30.4.1
status: done
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

- [x] CRUD integration tests incl. validation (each `SF-DOM-019x`), `If-Match`, roles (`EDITOR` without `RELEASE` →
      `403` on CRUD and for-asset; with `RELEASE` → for-asset allowed, CRUD still `403`), archived → `409 SF-DOM-0141`.
- [x] `for-asset` for a localized, paginated page creates the right entries per channel/locale/page number.
- [x] `state` computation: active, shadowed (source path is a live output), dangling (target not in the manifest).
- [x] Audit entries for manual changes only.
- [x] Export/import round trip of the registry (protocol 10), conflict on an existing source path, protocol-9 archive
      imports without redirects.
- [x] `./gradlew build` green.

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
- Deviation: changelog `v1.0/029-redirects.xml` (027 was taken) and export protocol **10**
  (`ProjectExportImportService.QUALITY_AND_REDIRECTS_PROTOCOL`; 9 is M27.8's schedules): a protocol `<= 9` archive
  imports without redirects even if it contains `redirects.json`.
- Deviation: `LOOP` is a fourth `RedirectState` (reported by the registry view, never emitted) instead of dropping the
  entry from the resolution, so the list can show why an entry isn't written. The resolver also marks redirects on (or
  leading into) a cycle of fixed-path redirects as `LOOP`, and the manual API rejects such cycles with `SF-DOM-0192`.
- Deviation: site files (sitemap, robots, search index, redirect stubs) are not "live outputs" for shadowing —
  otherwise the stubs M30.5.1 writes would shadow their own redirects in the next build.
- Deviation: `PUT` on an `AUTO` entry turns it `MANUAL` (someone owns it now, detection must not overwrite it);
  `DELETE` takes an optional `If-Match` (checked when sent). `for-asset` is `@projectAuth.can(#projectKey,'RELEASE')`
  alone: developers and admins always hold `RELEASE` (`PublishPolicy.grants`), so it already means "RELEASE or
  DEVELOPER+".
- Deviation: a second non-blocking import conflict `REDIRECT_INVALID` (unknown channel/locale, malformed paths in a
  hand-edited archive); `ConflictReport.redirectCount`, `ImportResult.importedRedirectCount/redirectWarnings`, and the
  import screen lists redirect warnings and counts (no provenance badge), like schedules.
- Paths: a directory source/target (`old/`, `/`) means the channel's `indexFileName`; `%XX` escapes are decoded; target
  query/fragment kept; everything but `http(s)` absolute URLs is refused (`SF-DOM-0193`).
- Seams for M30.4.2/M30.5.1: `RedirectService.upsertAuto(projectId, sourceRunId, List<AutoCandidate>)` →
  `AutoResult(added, replaced, keptManual)` (native insert-if-absent/update-AUTO, joins the caller's transaction);
  `RedirectResolver.resolve(List<RedirectRule>, RedirectOutputs)` (pure) and `RedirectService.resolve(...)`;
  `ManifestRedirectOutputs.of(BuildManifest | Collection<BuildManifest.Output>)` builds `RedirectOutputs`;
  `RedirectEntry.rule()`, `RedirectRule.toAsset/toPath(...)` for candidates.
