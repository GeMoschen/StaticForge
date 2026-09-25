# Feature: Release model — release pointers, status, release/unpublish/discard, Changes API

**Spec:** Extends §5 (domain model), §7 (revisions), §10.4–§10.5 (lifecycle, completeness), §20.2 (REST).

## Goal

Every editorial (asset, locale) has a revisioned *released version*; users can see each asset's release status per
locale, release (with dependencies), unpublish and discard, and list every unreleased change of a project.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-release-state-model-and-migration.md](001-release-state-model-and-migration.md) | `M26` |
| 2 | [002-release-service.md](002-release-service.md) | 1 |
| 3 | [003-release-and-changes-api.md](003-release-and-changes-api.md) | 2 |

## Feature exit criteria

- [x] `asset_release` exists, is revisioned and migrated: every existing editorial asset is `PUBLISHED` in every locale.
- [x] Status per (asset, locale) is correct for content, structural, localized-only and shared edits.
- [x] Release (with dependency closure), unpublish and discard work, each as one revision; incomplete content is refused.
- [x] Release, Changes and diff endpoints and the `release` block on asset DTOs are served; `schema.d.ts` regenerated.
- [x] `./gradlew build` green.

## Dependencies

`M16` (`asset_reference`, `ReferenceMaterializer`), `M15` (`beginBatch`), `M24` (`ProjectLocales`, fallback chains,
L10N values, `TranslationStatusService`), `M10.5` completeness validation (`ContentValidator`, `PageContentValidator`),
`M26` (`ProjectWriteGuard`, endpoint walk).
