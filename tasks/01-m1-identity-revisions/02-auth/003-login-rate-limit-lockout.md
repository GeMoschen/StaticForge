---
id: M1.2.3
status: done
depends: [M1.2.2]
epic: m1-identity-revisions
feature: auth
area: backend
---

# M1.2.3 — Login rate limiting & account lockout

## Context

Protect the login surface per §9.5.

## Goals

- Implement rate limiting on `/auth/login`: 10 attempts / 5 min / (IP + username), then
  exponential backoff.
- Implement account lockout after 15 failures until admin unlock or 30 min,
  wired to `app_user.status`/`failed_logins`/`locked_until`.
- Return `SF-API-0429` for rate-limited requests.

## Acceptance criteria

- [ ] Burst beyond 10/5min triggers backoff; `429` problem document returned.
- [ ] 15 failures locks the account; lock persists until unlock or timeout.
- [ ] Successful login resets the failure counter.

## Out of scope

- Previews/generation rate limits (later epics).

## Notes / hazards

- Keep limits configurable; log and observe lockouts via the metrics added in M0.
