---
id: M0.2.3
status: done
depends: [M0.2.1]
epic: m0-skeleton
feature: backend-bootstrap
area: backend
---

# M0.2.3 — Spring Security skeleton & problem documents

## Context

Stand up the stateless security posture and error model from §9.5 and §20.1 so every
later endpoint inherits consistent, RFC-9457 error handling.

## Goals

- Add a `SecurityFilterChain` matching §9.5: stateless, CSRF disabled for `/api/**`,
  `spring-boot-starter-oauth2-resource-server` wired with a `JwtDecoder` bean
  (real key config in M1; here a dev-only stub).
- Permit `/api/v1/auth/login`, `/api/v1/auth/refresh`, `/actuator/health`,
  `/.well-known/jwks.json`; require auth for everything else.
- Implement `problem+json` entry point / access-denied handler and a global
  `@ControllerAdvice` exception handler in `sf-common` (a `Problem` factory) so all
  errors conform to Appendix B codes (`SF-API-0401`, etc.).

## Acceptance criteria

- [ ] Unauthenticated access to a protected path returns `401` with
      `Content-Type: application/problem+json` and a `type`/`title`/`status`.
- [ ] `/actuator/health` remains unauthenticated for probes.
- [ ] A deliberately thrown exception is translated to a problem document, not a
      stack-trace HTML page.

## Out of scope

- JWT signing/validation and refresh tokens (M1).
- Role-based project authorization (M1).

## Notes / hazards

- Keep the `Problem` factory in `sf-common` so `sf-api` and domain can both use it
  without a web dependency on `sf-app`.
