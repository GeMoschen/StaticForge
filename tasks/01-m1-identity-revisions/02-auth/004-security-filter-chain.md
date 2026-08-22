---
id: M1.2.4
status: done
depends: [M1.2.1]
epic: m1-identity-revisions
feature: auth
area: backend
---

# M1.2.4 — Security filter chain & JWT converter

## Context

Finalize the security posture from the M0 skeleton into the real implementation of §9.5.

## Goals

- Replace the stub `SecurityFilterChain` with the §9.5 configuration: stateless,
  `oauth2ResourceServer` with the real `JwtDecoder`, `SfJwtAuthenticationConverter`
  mapping claims (`projects`, `sysRole`) into authorities, `hasAuthority("SYS_INSTANCE_ADMIN")`
  on `/api/v1/admin/**`.
- Keep `problemEntryPoint()`/`problemDeniedHandler()` returning problem documents.
- Permit `auth/login`, `auth/refresh`, `/.well-known/jwks.json`, `actuator/health`.

## Acceptance criteria

- [ ] Authenticated requests populate the security context with `projects` map +
      role, so `@PreAuthorize("@projectAuth.has(...)")` resolves correctly.
- [ ] `sysRole` maps to `SYS_INSTANCE_ADMIN` authority; `/api/v1/admin/**` gated.

## Out of scope

- Project authorization details (M1.1.2 owns those).

## Notes / hazards

- The converter must preserve `jti`/`subscription` for future service-to-service use.
