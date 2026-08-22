---
id: M2.1.4
status: done
depends: [M2.1.3]
epic: m2-templates-rendering
feature: cdl
area: backend
---

# M2.1.4 — CDL validate endpoint

## Context

Expose `POST /projects/{p}/cdl/validate` (§20.2) so Monaco renders squiggles while
typing, and save re-validates server-side (§14.7).

## Goals

- Implement `POST /cdl/validate` accepting `{source}` → diagnostics array.
- Ensure server-side re-validation on template save (never trust client validation).
- Return diagnostics with codes stable enough for quick-links in docs.

## Acceptance criteria

- [ ] The endpoint compiles arbitrary CDL and returns positioned diagnostics.
- [ ] Saving a template re-runs validation server-side.

## Out of scope

- Monaco integration (M3 UI).

## Notes / hazards

- Keep validation idempotent and fast (< 50 ms for typical CDL).
