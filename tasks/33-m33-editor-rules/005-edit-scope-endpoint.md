---
id: M33.5
status: done
depends: [M33.3]
epic: m33-editor-rules
feature: edit-scope-endpoint
area: backend
---

# M33.5 — Edit scope: `rules/evaluate` endpoint

## Context

New `RulesController` (sf-api), `DraftCheckService` / `DraftCheckView` (M30), render rate limiter
(`RenderRateLimiter`), project authorization. Epic decision 8; user decisions 17, 19.

## Goals

- `POST /projects/{p}/rules/evaluate` with `{ kind: PAGE|SECTION|RECORD|GLOBAL_SET, assetUuid?, templateUid |
  datasetUid | globalSetUid, content, bodies?, locale?, changedPaths? }` → `{ findings, fills, fieldStates }` from
  the engine in `EDIT` scope against the **unsaved** value; `ref()` reads drafts; nothing is stored.
- `locale` limits evaluation to one locale (the editing locale) plus the default locale for default-only built-ins;
  omitted → all project locales.
- Authorization: VIEWER, allowed on archived projects — evaluation is read-only and stores nothing (consistent with
  draft checks).
- Rate limit per user (shares the draft-check limiter budget, `429 SF-API-0429`).
- `DraftCheckView.completeness` switches to the engine's `EDIT` outcome of the stored draft.
- UI language from `Accept-Language` for `message`.

## Acceptance criteria

- [ ] API tests: findings of every level, fills and states returned; unsaved content evaluated (not the stored one);
      `ref` sees drafts; locale restriction; rate limit; authorization.
- [ ] Response time test: typical page < 50 ms server time.
- [ ] OpenAPI + `schema.d.ts` regenerated.
- [ ] `./gradlew build` green.

## Out of scope

- UI (M33.8).
