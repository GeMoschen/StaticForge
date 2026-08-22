---
id: M0.4.4
status: done
depends: [M0.4.1]
epic: m0-skeleton
feature: frontend-shell
area: frontend
---

# M0.4.4 — OpenAPI client generation pipeline

## Context

The API contract is OpenAPI 3.1 generated from Spring controllers, with a typed TS
client generated for Angular (§4.2 "API contract"). Establish that single-source-of-truth
pipeline now with a smoke contract.

## Goals

- Configure OpenAPI generation on the backend (`springdoc`/equivalent) producing an
  `openapi.yaml` from controllers (§4.2, §20).
- Configure a TS client generator (openapi-typescript or nswn/ormval-style) into
  `ui/src/app/core/api/generated/`.
- Wire `openapi-diff` in CI so breaking API changes are detected (§25.1 contract tests).
- Provide a minimal sample controller to exercise generation end-to-end.

## Acceptance criteria

- [ ] `./gradlew :server:sf-api:generateOpenApi` (or agreed task) emits the OpenAPI doc.
- [ ] A generated TS client compiles and is importable in the Angular app.
- [ ] `openapi-diff` runs in CI and reports on contract drift.

## Out of scope

- Real endpoints (M1+). The smoke controller is temporary.

## Notes / hazards

- Ensure the generator output is committed or build-time reproducible; pick one and
  document it in `docs/`.
