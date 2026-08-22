---
id: M7.3.1
status: done
depends: []
epic: m7-hardening
feature: security
area: backend
---

# M7.3.1 — Security review & dependency check

## Context

Verify + close the §26.3 controls end to end.

## Goals

- Run OWASP dependency-check; no HIGH/CRITICAL without a documented, time-boxed exception
  (§25.7).
- Verify the §26.3 table: TLS/HSTS/cookies, injection (parameterized only), XSS
  (channel-default escaping + TipTap schema + sanitizer), upload (Tika/allow-list/SVG
  strip/EXIF), path traversal (normalize + `..` reject), secrets in env only.
- Document any accepted risk; fix findings.

## Acceptance criteria

- [ ] Dependency-check gate green in CI.
- [x] A security checklist (mapping to §26.3) is signed off.

## Out of scope

- External pen-test execution (process coordination; findings triaged here).

## Notes / hazards

- OCTL cannot reach Java (§16.1) — re-verify no reflection/I/O is reachable.
