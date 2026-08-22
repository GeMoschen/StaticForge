# M7 — Hardening — Results

## Status: implemented (13/13 tasks), backend + frontend build + tests green, nightly/CI gates configured

M7 delivered the a11y sweep (focus ring, landmarks, one-h1-per-route, live regions, skip
link), an automated WCAG contrast-matrix test, the frontend bundle budget, a generation
benchmark fixture/harness, `audit_log` + Micrometer/Actuator observability, a §26.3
security checklist, project export/import (ZIP, UUIDv7 + `payload.origin`), CI quality-gate
workflows, E2E journeys 9–12, the full docs set, backup/deploy runbooks, and the Appendix C
open-question resolutions — across 7 agents.

## What was built

| Feature | Deliverables |
|---|---|
| a11y (frontend) | global 2px `--sf-signal` focus ring + skip-link + `.sf-sr-only` (`styles.scss`); one `h1`/route + `<main>` landmarks across routes; `aria-current`/`aria-label` on nav + icon buttons; `aria-live` save/generation status + `role="alert"` errors; `ui/e2e/a11y.spec.ts` (gated) |
| contrast/motion | `tokens.contrast.spec.ts` (18 vitest cases, inline WCAG luminance) — body ≥ 7:1, UI ≥ 4.5:1 both themes; reduced-motion already global |
| frontend perf | `angular.json` initial-bundle budget (320 kB warn / 350 kB error, current 270 kB); audited all `@for` loops already `track`-ed; `docs/frontend-performance.md` |
| generation bench | perf-gated `GenerationBenchmark` (real-service fixture, FULL + INCREMENTAL timing) + `infra/scripts/benchmark-generation.sh` + `README-benchmark.md` |
| security | `docs/security-review.md` mapping every §26.3 control to code; OWASP/OTel wired as documented CI/nightly follow-ups (offline-safe) |
| audit/observability | `audit_log` (Liquibase `011`, entity/repo/`AuditService`) on auth/membership/channel/target changes + `GET /projects/{p}/audit`; Actuator + Micrometer (`sf.revision.allocate`, `sf.render.duration`, `sf.generation.duration/.files`, `sf.media.upload.bytes`) + `BlobStoreHealthIndicator` + `/metrics`/`/health` |
| export/import | `GET /projects/{p}/export` (ZIP: `manifest.json`+`assets.json`+deduped blobs) and `POST /projects/{p}/import` (fresh UUIDv7 + `payload.origin` + UUID remap + UID re-derive), one `IMPORT` revision |
| quality gates (CI) | 5 workflows: `quality-gates`, `dependency-check-nightly`, `postgres-dialect-nightly`, `e2e`, `benchmark-nightly`; `jacocoCoverageGate` report-only (current line 59% < 80% target) |
| e2e | `ui/e2e/m7-journeys.spec.ts` (journeys 9–12) + `ui/e2e/README.md` (12-journey map) |
| docs/ops | `docs/{architecture,api,template-developer-guide,user-guide,release-readiness}` + 5 ADRs + `infra/docs/{backup-recovery,deploy}-runbook.md`; Appendix C Q1/Q5/Q6 resolved |

## Verification
- [x] `./gradlew clean build` BUILD SUCCESSFUL (54 tasks; spotless, `checkModuleLayers`,
      all tests incl. `ExportImportLogicTest`, `ProjectExportImportIntegrationTest`).
- [x] `generateOpenApi` + `npm run generate:api` regenerated `openapi.json` + `schema.d.ts`.
- [x] `ui` `npm run build` green (initial 270 kB within budget); `npm test` green (88 tests, was 70).
- [x] `npx playwright test m7-journeys.spec.ts --list` collect clean (4 tests).

## Honest gaps / follow-ups (configured but not executed in this environment)
- **Gated**: axe zero-violation, journeys 9–12 and full 12-journey suite need the still-deferred
  demo seed (`SF_RUN_E2E`); all 6 CI workflows are valid YAML but never run here.
- **Below target**: backend coverage is ~59% line (target 80%) — `jacocoCoverageGate` is
  report-only; raising coverage belongs to the owning features, not M7 (§25.7/M7.5.1).
- **Deferred manually**: OWASP dependency-check + OpenTelemetry tracing + §26.4 alert rules are
  documented (not wired) to stay offline-safe; run in the nightly workflows.
- **Token finding**: light `--sf-amber` #C77A0A is 3.38:1 on white (below 4.5) — spec-verbatim;
  kept as graphical/3:1, flagged for a token bump decision.
- **Latent spec-vs-code drift** (from `docs/release-readiness.md`): CDL codes `SF-CDL-0101…`
  and codes `SF-GEN-0220`/`SF-GEN-0301` exist in spec but not all as constants; CI is a single
  skeleton workflow pre-M7.

---

# M6 — Revision UX & collaboration — Results (previous)

Implemented 8/8 across 5 agents: revision spine + time-travel, timeline + block-level diff +
restore, field-level conflict drawer, usages + UID-rename warning, journeys 5–8. Verified
green (see `tasks/06-m6-revision-ux/README.md`).

# M5 — Channels & navigation — Results (previous)

Implemented 8/8 across 5 agents (see `tasks/05-m5-channels-navigation/README.md`).
