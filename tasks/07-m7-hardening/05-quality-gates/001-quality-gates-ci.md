---
id: M7.5.1
status: done
depends: [M0.1.3]
epic: m7-hardening
feature: quality-gates
area: qa
---

# M7.5.1 — CI quality gates

## Context

Enforce the §25.7 gates reproducibly.

## Goals

- Coverage: backend line ≥ 80% / branch ≥ 70% (render + revision ≥ 90%); frontend
  statements ≥ 75% (form engine + stores ≥ 90%).
- Zero axe serious/critical; OWASP no HIGH/CRITICAL; Liquibase `status` clean vs a restored
  production dump; bundle budget enforced.
- Contract check (openapi-diff) gated; dialect suite vs real Postgres nightly (§22.3).

## Acceptance criteria

- [ ] All gates wired into CI and currently passing.

## Out of scope

- Attaining coverage that's missing (that's the ownership of the owning features).

## Notes / hazards

- Add the Postgres Testcontainers nightly job here (§22.4 rule 6).
