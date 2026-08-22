# Feature: Security & observability completion

**Spec:** §26.3 (security), §26.4 (observability), §25.7 (OWASP).
**Area:** backend. **Epic:** M7.

## Goal

Close security findings and complete the audit/telemetry story.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-security-review.md](001-security-review.md) | — |
| 2 | [002-audit-log-observability.md](002-audit-log-observability.md) | M0.2.2 |

## Feature exit criteria

- [ ] No OWASP HIGH/CRITICAL findings without a time-boxed exception; pen-test findings
      closed.
- [ ] `audit_log` covers auth/membership/channel/target changes; metrics/tracing/alerts
      complete.

## Dependencies

`M0` observability foundation.
