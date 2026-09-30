---
id: M34.2
status: done
depends: [M34.1]
epic: m34-cdl-tabs-one-save
feature: api
area: backend
---

# M34.2 — Payload, API and domain on sections

## Context

Template, dataset and global-set commands, views, services and controllers; every reader of the stored CDL
(render, generation, references, search, localization, compile caches). User decisions 1–3 and 6.

## Goals

- Commands and views carry `CdlSources`; payloads store the three fields; every reader compiles `CdlSources.of(payload)`
  (cache keys included).
- Requests/responses: templates `contentCdl`/`bodiesCdl`/`rulesCdl`; datasets and global sets `contentCdl`/`rulesCdl`;
  `/cdl/validate` and `/octl/validate` take the sections.
- A section template with a non-empty `bodiesCdl` is rejected (`field: bodies`); OCTL save errors carry
  `field: channel:<key>`; whole-definition findings without a position are placed on `content`.

## Acceptance criteria

- [x] `./gradlew test` green except the known Linux-only `GenerationIntegrationTest` symlink case.
- [x] OpenAPI regenerated; the UI types match.
