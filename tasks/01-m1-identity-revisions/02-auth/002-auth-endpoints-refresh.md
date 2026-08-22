---
id: M1.2.2
status: done
depends: [M1.2.1]
epic: m1-identity-revisions
feature: auth
area: backend
---

# M1.2.2 — Auth endpoints & refresh-token rotation

## Context

Implement the five endpoints of §9.4 and the rotating refresh-token family model of §9.1
and §9.3.

## Goals

- Implement `POST /auth/login` (username+password → access token + refresh cookie),
  `POST /auth/refresh` (rotates refresh, issues new access), `POST /auth/logout`
  (revoke family), `GET /auth/me`, `POST /auth/password`.
- Model refresh tokens as opaque server-side rows in a family (`refresh_token` table),
  rotated on every use; reject and invalidate the whole family on reuse (theft detection).
- Set the refresh cookie with `HttpOnly; Secure; SameSite=Strict`, path `/api/v1/auth`;
  protect refresh with `X-Requested-With` check.
- Verify BCrypt cost 12 (Argon2id configurable in §8.2).

## Acceptance criteria

- [ ] Login returns access token (never to JS-accessible storage) + refresh cookie.
- [ ] Refresh rotates the token; reusing a consumed refresh invalidates the family.
- [ ] Logout revokes the family; `/auth/me` returns principal + memberships + capabilities.

## Out of scope

- Rate limiting/lockout (next task).

## Notes / hazards

- Never put the access token near `localStorage`; the frontend keeps it in a signal (§9.1).
