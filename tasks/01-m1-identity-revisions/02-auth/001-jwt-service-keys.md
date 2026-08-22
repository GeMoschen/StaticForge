---
id: M1.2.1
status: done
depends: [M1.1.1]
epic: m1-identity-revisions
feature: auth
area: backend
---

# M1.2.1 — JWT service & key management

## Context

Implement token issuance/validation and key handling per §9.1–9.3.

## Goals

- Implement `JwtService` issuing access tokens with claims in §9.2 (`iss`, `sub`,
  `preferred_username`, `name`, `sysRole`, `projects` map, `jti`, `iat`, `exp`).
- Support RS256 (2048-bit, keystore/PEM) with `kid`, JWKS at `/.well-known/jwks.json`,
  and two active keys (current + previous) for rotation; HS256 for dev profiles only.
- Enforce `tokenEpoch`: reject tokens whose `iat` predates the user's epoch.

## Acceptance criteria

- [ ] An issued token carries the §9.2 claims and validates in the resource server.
- [ ] JWKS endpoint exposes current + previous keys; rotation does not invalidate live
      tokens.
- [ ] A token issued before an epoch bump is rejected.

## Out of scope

- Refresh token storage/rotation (next task).
- The security filter chain (task 4).

## Notes / hazards

- HS256 must be gated to non-prod profiles (§9.3); add an assert/guard.
