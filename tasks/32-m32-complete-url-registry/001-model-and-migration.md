---
id: M32.1
status: done
depends: []
epic: m32-complete-url-registry
feature: model-and-migration
area: backend
---

# M32.1 — Model and migration

## Context

`UrlRegistryEntry`, `UrlRegistryRepository`, `ResetScope`, `UrlArea` (sf-domain `urlregistry`); changelogs
`014-url-registry.xml`, `018-url-registry-locale.xml`. Epic decisions 1, 12; user decision 9.

## Goals

- Re-key `url_registry_entry` to `(project_id, channel_key, area, locale_key, target_type, target_uuid, variant_key,
  page_number)`: new `target_type` (`PAGE | MEDIA | FOLDER`, enum `UrlTargetType`), `target_uuid` replacing
  `page_reference_uuid`, `variant_key` (`''` except media variants), `page_number` (`1` except paginated outputs).
- A second unique index `(project_id, channel_key, area, locale_key, url)` — one URL, one target.
- Liquibase `030-url-registry-all-targets.xml`: delete every existing row (page-reference rows are dropped, user
  decision 9), then migrate columns and constraints. H2 and PostgreSQL.
- `UrlTarget(type, uuid, variant, pageNumber)` value record with factories `page(uuid)`, `page(uuid, n)`,
  `media(uuid, variant)`, `folder(uuid)`.
- `UrlRegistryRepository`: `insertIfAbsent` on the new key, lookups by target, by URL (collision check), bulk load per
  `(project, channel, area, locale)`, deletes by target (computed only / all), by target and `page_number > n`.
- `ResetScope.Kind.ASSET` (all rows of one target uuid).

## Acceptance criteria

- [x] Migration runs on an existing database with page-reference rows: all rows gone, new schema in place.
- [x] Repository tests: unique key, URL uniqueness per `(project, channel, area, locale)`, media rows with
      `channel_key = ''`, delete-by-target keeps overrides when asked to.
- [x] `./gradlew build` green.

## Out of scope

- Service behavior (M32.2), callers (M32.3+).

## Notes / hazards

- `insertIfAbsent` is the only native query (M23 note); keep it portable (H2 + PostgreSQL `ON CONFLICT DO NOTHING`
  equivalent already used there). With the second unique index, a URL clash must be told apart from "row already
  there" — the service (M32.2) checks by URL first.
- The UI and API still compile against the old fields until M32.7/M32.8; keep changes to the domain layer and adapt the
  controller minimally so the build stays green.
