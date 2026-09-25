---
id: M30.1.2
status: todo
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

- [ ] Config round trip: defaults, override, reset to default removes the stored entry; invalid body → `400` with
      per-entry messages; `EDITOR` → `403`; archived project → `409 SF-DOM-0141`.
- [ ] `PUT` writes exactly one revision and one audit entry; a `PUT` that changes nothing writes neither.
- [ ] Findings API: paging, each filter, caps and `truncated`, run of another project → `404`.
- [ ] Liquibase changelog runs on H2 and PostgreSQL (dialect test if available).
- [ ] `./gradlew build` green.

## Out of scope

- Running the rules in a build (`M30.1.3`), the UI (`M30.6.1`, `M30.6.2`).

## Notes / hazards

- Declare every new service overload abstract in the interface and `@Transactional` in the impl (lessons: no
  `default` methods delegating into proxied behaviour).
- `finding_counts` is what the run list shows; don't make the run list query the findings table.
- Retention: findings go with their run (FK `ON DELETE CASCADE` or explicit delete in the M29 run-retention job — pick
  one and say it in the changelog comment).
