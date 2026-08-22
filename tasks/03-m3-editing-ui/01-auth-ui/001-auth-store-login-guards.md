---
id: M3.1.1
status: done
depends: [M1.2.2]
epic: m3-editing-ui
feature: auth-ui
area: frontend
---

# M3.1.1 — Auth store, login page, guards

## Context

Implement §23.3's client auth: the store holds the access token in a signal and never in
`localStorage`.

## Goals

- Implement `authStore` (access token as a signal, user info, memberships, capabilities).
- Build the login page (§24.5 #1: single card, no marketing).
- Implement `authGuard` and `projectMemberGuard(minRole)` reading roles from the decoded
  token (§23.3) — navigation never waits on a network call.
- Preserve `returnUrl` through login; add `canDeactivate` on editors (save/discard/stay).

## Acceptance criteria

- [ ] Login sets the in-memory token; refresh of the page re-auths via refresh cookie.
- [ ] Guards block unauthorized navigation instantly from the token's roles.

## Out of scope

- Interceptors (next task).

## Notes / hazards

- The access token must be invisible to XSS — never persist it.
