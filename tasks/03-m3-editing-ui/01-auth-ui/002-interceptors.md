---
id: M3.1.2
status: done
depends: [M3.1.1]
epic: m3-editing-ui
feature: auth-ui
area: frontend
---

# M3.1.2 — HTTP interceptors (JWT, refresh, ETag)

## Context

Implement §23.3's interceptor stack so every request is authenticated and 401s recover
transparently.

## Goals

- `jwtInterceptor`: attach `Authorization: Bearer …`.
- `refreshInterceptor`: catch `401`, single-flight refresh (pause + retry concurrent
  requests once), route to `/login` on failure preserving `returnUrl`.
- Silent refresh timer at 80% of token lifetime.
- `etagInterceptor`: attach/store `If-Match`/`ETag` for concurrency (§20.1, §23.2)
  plus error translating to problem documents.

## Acceptance criteria

- [ ] A `401` triggers one refresh and retries, never a refresh storm.
- [ ] Stale tokens refresh silently before expiry.
- [ ] `If-Match` is sent on mutations using the asset's current `validFromRevision`.

## Out of scope

- Conflict *UI* (M6) — here just surface the `409` payload.

## Notes / hazards

- Keep refresh single-flight to avoid thundering-herd refreshes.
