---
id: M32.7
status: done
depends: [M32.2]
epic: m32-complete-url-registry
feature: rest-api
area: backend
---

# M32.7 — REST API

## Context

`UrlRegistryController`, `UrlRegistryEntryView`, `UrlRegistryOverrideRequest`, `UrlRegistryResetRequest`, import
endpoint request DTO, M8.2.4 endpoint list. Epic decisions 3, 9, 10, 12.

## Goals

- `GET /projects/{p}/url-registry`: filters `channel`, `area`, `targetType`, `locale`, `targetUuid`, `q` (asset name
  or url). `UrlRegistryEntryView`: `id`, `channelKey`, `area`, `locale`, `targetType`, `targetUuid`, `targetLabel`,
  `targetPath`, `variant`, `pageNumber`, `url`, `overridden`, `assignedAt`, `assignedRevision` (drops
  `pageReferenceUuid` / `pageReferenceLabel`).
- Override `PUT` takes a target (`targetType`, `targetUuid`, `variant`, `pageNumber`, `channelKey`, `area`, `locale`,
  `url`); `409 SF-DOM-0200`, `422 SF-DOM-0201`. Page references and indexed folders are refused (`422`, they're
  derived).
- Reset `POST` gains scope `ASSET` (`targetUuid`).
- Import request gains `urlRegistryMode`; analysis response shows the per-mode effect.
- Roles unchanged (read VIEWER, override DEVELOPER, reset PROJECT_ADMIN); archived projects refused (`SF-DOM-0141`).
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] Controller tests for every filter, override errors, `ASSET` reset, role checks.
- [x] OpenAPI and `schema.d.ts` regenerated.
- [x] `./gradlew build` green.

## Out of scope

- UI (M32.8).
