---
id: M7.6.1
status: done
depends: []
epic: m7-hardening
feature: docs
area: all
---

# M7.6.1 — Documentation

## Context

Produce the release documentation set.

## Goals

- Architecture docs + ADRs (module layering, revision design, OCTL/CDL languages).
- API reference (from the OpenAPI doc) + error-code catalogue (Appendix B).
- Template-developer guide (CDL + OCTL reference + diagnostics); editor/user guide.

## Acceptance criteria

- [x] `docs/` contains the four doc sets; ADRs cover the major §4/§5/§7 decisions.

## Out of scope

- Video tutorials.

## Notes / hazards

- Link diagnostics codes to the reference docs (§24.6 "errors carry the fix").
