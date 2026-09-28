---
id: M30.1.2
status: done
depends: [M30.1.1]
epic: m30-quality-checks-and-redirects
feature: check-framework
area: backend
---

# M30.1.2 — Rule configuration per project, findings table and API

## Context

`Project` (`sf-domain/.../project/Project.java`: `allowed_mime_types`, `locale_config` JSON), `ProjectController`
(`PUT /projects/{key}/locales` as the model for a validated settings endpoint with an `errors` list),
`ChannelServiceImpl.outputSettingsChangedSince` (how a live setting change is detected from revision summaries),
`GenerationRun`/`GenerationRunView`, `GenerationController`, `AuditService`, Liquibase `v1.0/026-quality-checks.xml`.
Epic decisions 4, 9, 10.

## Goals

- **Config.** Column `project.quality_rule_config` (JSON, nullable = all defaults). `QualityRuleConfigService`:
  effective config = defaults from the registry overlaid with the stored entries; unknown codes are dropped on read
  (a rule removed in a later version doesn't break a project) and rejected on write.
- `GET /projects/{key}/quality-rules` (`VIEWER`): every rule with `code`, `name`, `category`, `description`,
  `defaultSeverity`, `severity`, `params` (value, default, min, max), `channels` note ("HTML channels only").
- `PUT /projects/{key}/quality-rules` (`DEVELOPER`): `{rules:{code:{severity, params}}}`; `400 SF-API-0400` with one
  message per invalid entry (unknown code, bad severity, param out of bounds); stores only entries that differ from
  the default; records a revision with a `PROJECT` summary entry `qualityRules` (so time travel shows it read-only and
  the planner can detect the change) and audits `QUALITY_RULES_UPDATED` with the changed codes in `detail`.
  `qualityRulesChangedSince(projectId, revision)` for the planner (`M30.1.3`).
- **Findings.** Table `generation_run_finding` (id, run_id FK, asset_uuid, channel, locale, page_number, output_path,
  code, category, severity, message, selector, section_instance_id, carried) with indexes on
  `(run_id, severity, category)` and `(run_id, asset_uuid)`. `generation_run` gains `finding_errors`,
  `finding_warnings`, `finding_truncated` and `finding_counts` (JSON by category).
- `RunFindingStore.save(runId, findings)` in batches (JDBC batch, not one `save` per row), enforcing the per-output and
  per-run caps (`sf.quality.max-findings-per-output` 50, `sf.quality.max-findings-per-run` 100,000 in a new
  `QualityProperties`), counting what was dropped.
- `GET /projects/{key}/generations/{runId}/findings` (`VIEWER`): paged (`page`, `size` ≤ 200), filters `severity`,
  `category`, `code` (multi), `assetUuid`, `channel`, `locale`, `pathPrefix`; sorted by output path, then code. Each row
  carries the page's current uid and display name (resolved at read time; `null` when deleted).
- `GenerationRunView` gains `findingCounts {errors, warnings, byCategory, truncated}`.
- Export/import: the full-project archive carries `quality_rule_config` next to the locale settings (M24 pattern);
  unknown codes in an imported config are dropped with a non-blocking conflict entry. Protocol bump shared with
  `M30.4.1` (protocol 9).
- Regenerate OpenAPI and `schema.d.ts`.

## Acceptance criteria

- [x] Config round trip: defaults, override, reset to default removes the stored entry; invalid body → `400` with
      per-entry messages; `EDITOR` → `403`; archived project → `409 SF-DOM-0141`.
- [x] `PUT` writes exactly one revision and one audit entry; a `PUT` that changes nothing writes neither.
- [x] Findings API: paging, each filter, caps and `truncated`, run of another project → `404`.
- [x] Liquibase changelog runs on H2 and PostgreSQL (dialect test if available) — H2 proven by every test context;
      no PostgreSQL on this machine (see notes).
- [x] `./gradlew build` green.

## Out of scope

- Running the rules in a build (`M30.1.3`), the UI (`M30.6.1`, `M30.6.2`).

## Notes / hazards

- Declare every new service overload abstract in the interface and `@Transactional` in the impl (lessons: no
  `default` methods delegating into proxied behaviour).
- `finding_counts` is what the run list shows; don't make the run list query the findings table.
- Retention: findings go with their run (FK `ON DELETE CASCADE` or explicit delete in the M29 run-retention job — pick
  one and say it in the changelog comment).
- Deviation: changelog is `v1.0/028-quality-checks.xml` (026/027 taken); archives are protocol **10** (9 is M27.8).
  Quality config is imported only from protocol >= 10 archives, only when the target project has none of its own
  (settings import never overwrites, like the locale config); unknown codes are dropped with a non-blocking
  `UNKNOWN_QUALITY_RULE` conflict. The import learns the known codes through `QualityRuleCatalog` (sf-domain interface,
  implemented by `QualityRuleRegistry`).
- Deviation: `PUT /quality-rules` replaces the whole configuration (a rule missing from the body is at its default).
- Retention: FK `ON DELETE CASCADE` **and** an explicit delete in the `generation-run-retention` batch (like plan rows).
- Counts on the run (`finding_errors/warnings/counts`) cover every finding; the caps (`sf.quality.*`) only limit what
  is stored (errors are stored first) and the dropped number is `finding_truncated`.
- Liquibase: proven on H2 only (no PostgreSQL/Docker here); the JSON columns follow the per-dialect pattern of 017/027.
- `QualityRuleSetting.params` generates as `Record<string, never>` values in `schema.d.ts` (springdoc maps `Object`
  to `object`); the response's param `value`/`defaultValue` are `number | boolean`.
- Tests: `QualityRulesApiTest`, `RunFindingsApiTest`, `QualityRulesExportImportIntegrationTest`; test-only rules in
  `QualityTestRules` (`SF-CHK-0190`, `0191`, `0390` — codes the catalogue leaves free).
