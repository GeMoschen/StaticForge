# Feature: Authentication (JWT)

**Spec:** §9 (token model, claims, signing, endpoints, security config).
**Area:** backend. **Epic:** M1.

## Goal

Implement the full JWT auth flow: access + rotating refresh tokens, RS256 signing with
key rotation, the auth endpoints, rate limiting/lockout, and the security filter chain.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-jwt-service-keys.md](001-jwt-service-keys.md) | M1.1.1 |
| 2 | [002-auth-endpoints-refresh.md](002-auth-endpoints-refresh.md) | 1 |
| 3 | [003-login-rate-limit-lockout.md](003-login-rate-limit-lockout.md) | 2 |
| 4 | [004-security-filter-chain.md](004-security-filter-chain.md) | 1, M1.1.2 |

## Feature exit criteria

- [ ] Login returns an access token (in-memory) + `HttpOnly; Secure; SameSite=Strict`
      refresh cookie; refresh rotates tokens and detects reuse (family invalidation).
- [ ] Membership changes bump `tokenEpoch`; stale tokens rejected by `iat`.
- [ ] All five auth endpoints (§9.4) work; login rate limiting + lockout active.

## Dependencies

`M1:project-domain` (users/membership + token_epoch).
