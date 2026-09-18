---
id: M24.1.1
status: done
depends: []
epic: m24-multi-language
feature: project-locales
area: backend
---

# M24.1.1 — Project locale configuration (domain + API)

## Context

`Project` (`server/sf-domain/.../project/Project.java`) has `key, name, description,
archived, allowedMimeTypes, createdAt, createdBy` and no locale concept.
`ProjectServiceImpl.update(key, name, description, allowedMimeTypes, ctx)` allocates an
`UPDATE` revision (`revisionService.allocate(...)`, ~line 155) and overwrites columns in
place. `ProjectUpdateRequest(name, description, allowedMimeTypes)` is the PUT body in
`ProjectController`. Nothing in generation, preview or rendering knows about locales.

## Goals

- Add a `LocaleConfig` value type in `sf-domain` (`project` package): ordered
  `List<ProjectLocale(code, label)>`, `defaultLocale`, `Map<String, List<String>>
  fallbacks`, `boolean defaultWithoutPrefix`, plus:
  - `isLocalized()` — `true` when at least one locale is declared;
  - `effectiveChain(String locale)` — the locale itself, its declared fallbacks, then the
    default locale, deduplicated;
  - `EMPTY` constant for today's single-language projects.
- Validation (400 with `Problem` field errors):
  - codes are BCP 47 language tags (`Locale.forLanguageTag(code).toLanguageTag()`
    round-trips), unique case-insensitively, normalized to canonical form;
  - `defaultLocale` is one of the declared codes (required when any locale exists);
  - every fallback key/target is a declared code; no cycles; a locale can't fall back to
    itself;
  - removing a locale that still has stored L10N values is **allowed** but the response
    carries a warning count (values are kept, not deleted — see Notes).
- Persist as a JSON column `project.locale_config` (next free Liquibase changelog in
  `server/sf-app/src/main/resources/db/changelog/v1.0/`, paired `dbms="postgresql"` JSONB /
  `dbms="h2"` JSON changesets like `002-assets.xml`), nullable = `LocaleConfig.EMPTY`.
- `ProjectService`: `updateLocales(key, LocaleConfig, RevisionContext)` allocating one
  `UPDATE` revision; `locales(projectId)` read accessor used by later tasks (cached per
  request; no global cache needed).
- REST: `GET /api/v1/projects/{key}/locales`, `PUT /api/v1/projects/{key}/locales`
  (`PROJECT_ADMIN`), DTOs, regenerated OpenAPI + `ui/src/app/core/api/generated/schema.d.ts`.
- Time-travel: the endpoint is a mutating request and is already covered by the M15.5
  read-only interceptor; add it to the backstop test list if that list is explicit.

## Acceptance criteria

- [x] `LocaleConfig` unit tests: normalization, default required, unknown fallback target,
      cycle (`de→en→de`) rejected, `effectiveChain("de-CH")` = `[de-CH, de, <default>]`.
- [x] Liquibase changeset runs on H2 (tests) and is dbms-paired for PostgreSQL;
      `ddl-auto: validate` passes.
- [x] `PUT /locales` persists, returns the normalized config, and produces exactly one
      revision with `ChangeType.UPDATE`; `VIEWER`/`EDITOR` get 403.
- [x] A project that never set locales returns `{locales:[], defaultLocale:null,
      fallbacks:{}, defaultWithoutPrefix:false}` and every existing test passes unchanged.
- [x] `./gradlew :server:sf-domain:test :server:sf-api:test` green.

## Out of scope

- Any use of the configuration in CDL, rendering, generation or UI (M24.2–M24.4).
- Versioning project settings per revision (see epic Notes).
- Export/import of the configuration (M24.5.1).

## Notes / hazards

- Removing a locale must not delete content: L10N values for undeclared locales stay in
  payloads (and are reported by M24.4.2 / import conflict analysis) so re-adding the
  locale restores them.
- Adding the **first** locale changes every output URL of an existing project once
  M24.3.2 lands. The API only stores; the warning belongs to the UI (M24.1.2), but the
  response should include `urlsWillChange: true` when `isLocalized()` flips or
  `defaultWithoutPrefix` changes, so the UI doesn't have to recompute it.
- Keep `allowedMimeTypes` on `ProjectUpdateRequest` untouched — locales get their own
  endpoint so the general settings form can't wipe them.
