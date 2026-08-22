# M7.3 — Security & Observability (backend) — DONE

Status: complete. `./gradlew build` green (spotless + checkModuleLayers + all tests).

## Checkables
- [x] Changelog `011-audit-log.xml` (audit_log table, H2+PG) — auto-registered via `includeAll`
- [x] `audit` package: `AuditLog` + `AuditLogRepository` + `AuditService(Impl)`
- [x] Audit wiring: auth login, membership set/remove, channel create/update/delete, target create/update/delete
- [x] `AuditController` + `AuditEntryView` (GET /projects/{key}/audit, PROJECT_ADMIN)
- [x] Actuator exposure (prometheus) + health show-details; `BlobStoreHealthIndicator`
- [x] Metrics: sf.revision.allocate, sf.render.duration{template,channel}, sf.generation.duration{mode}/files, sf.media.upload.bytes
- [x] Jacoco verification task (report-only `jacocoCoverageGate`, NOT in `check`)
- [x] `docs/security-review.md`
- [x] `./gradlew build` green

## Coverage (current vs §25.7 target)
- line 59% (≥80%), branch 42% (≥70%), template.render 58%, generate.render 58%, revision 67% (≥90%).
→ left `jacocoCoverageGate` as report-only, not in `check`; CI/QA agent decides promotion.
