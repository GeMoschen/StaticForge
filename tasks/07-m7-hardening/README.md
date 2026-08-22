# M7 — Hardening

**Spec:** §24.7 (a11y), §25 (testing/quality), §26 (NFRs), §2.1 (goals).
Roadmap M7 (§27): 3 weeks.

## Goal

Make the product production-ready: accessibility sweep, performance tuning, security
review + observability completion, ops/backup/export-import, and meeting every quality
gate.

## Exit criteria (epic is done when)

- [ ] Quality gates (§25.7) met; pen-test findings closed. _(gates are wired as CI workflows + a report-only coverage task; coverage is below the 80% target and axe/OWASP/dialect run nightly — see `tasks/todo.md`.)_
- [ ] §2.1 goals (G1–G6) demonstrably satisfied. _(G2/G3/G4 proven by tests; G1/G5/G6 evidenced but wall-clock publish, the 5,000-page bench, and the axe/screen-reader pass are gated/nightly — see `docs/release-readiness.md`.)_

## Implementation status

All 13 tasks implemented across 7 agents (2 backend + 2 frontend + 1 QA + 1 docs/ops + 1 platform):

| Feature | Deliverables |
|---|---|
| a11y | global focus ring + skip link, one-`h1`/landmarks/`aria-current`/`aria-label`/`aria-live` fixes, `tokens.contrast.spec.ts` (WCAG matrix), `ui/e2e/a11y.spec.ts` (gated) |
| performance | `angular.json` initial-bundle budget; all `@for` loops `track`-ed; perf-gated `GenerationBenchmark` + `infra/scripts/benchmark-generation.sh` |
| security | `docs/security-review.md` (§26.3 checklist); OWASP + OTel documented for CI/nightly |
| audit/observability | `audit_log` + `GET /projects/{p}/audit`; Actuator + Micrometer metrics + blobs health; `jacocoCoverageGate` (report-only) |
| operations | project export/import (ZIP, UUIDv7, `payload.origin`); `infra/docs/{backup-recovery,deploy}-runbook.md` |
| quality-gates | 5 GitHub Actions workflows (quality-gates, dependency-check, postgres-dialect, e2e, benchmark — latter four nightly/manual) |
| docs | `docs/{architecture,api,template-developer-guide,user-guide,release-readiness}` + ADRs; Appendix C Q1/Q5/Q6 resolved |

Verified: `./gradlew clean build` green; `npm run build` green; `npm test` green (88 tests);
OpenAPI + `schema.d.ts` regenerated; `m7-journeys.spec.ts` collects clean.

## Features (dependency order)

| # | Feature | Area | Depends |
|---|---|---|---|
| 1 | [a11y](01-a11y/README.md) | frontend | — |
| 2 | [performance](02-performance/README.md) | fullstack | — |
| 3 | [security](03-security/README.md) | backend | — |
| 4 | [operations](04-operations/README.md) | infra | — |
| 5 | [quality-gates](05-quality-gates/README.md) | qa | 1–4 |
| 6 | [docs](06-docs/README.md) | all | — |
| 7 | [roadmap-reserve](07-roadmap-reserve/README.md) | product | — |

## Dependencies

All prior epics (M0–M6).
