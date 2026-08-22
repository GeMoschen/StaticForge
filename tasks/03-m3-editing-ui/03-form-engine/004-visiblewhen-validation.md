---
id: M3.3.4
status: done
depends: [M3.3.1, M2.2.1]
epic: m3-editing-ui
feature: form-engine
area: frontend
---

# M3.3.4 — visibleWhen & validation parity

## Context

Implement the frontend `ExpressionEvaluator` and validation to match the backend exactly
via the shared fixture file (§14.4, §23.5).

## Goals

- Implement the frontend `ExpressionEvaluator` for the §14.4 grammar.
- Consume the **same** JSON test-fixtures file as the backend evaluator (M2.2.1).
- Apply `visibleWhen` to show/hide + conditionally require editors reactively.
- Mirror backend validation (required/maxLength/pattern/min/max/mimeTypes) client-side
  for instant feedback.

## Acceptance criteria

- [ ] Frontend evaluator passes the shared fixture file identically.
- [ ] `visibleWhen "showCta == true"` toggles visibility reactively as `showCta` changes.

## Out of scope

- Server is always the final authority (§14.7) — client is advisory.

## Notes / hazards

- One grammar, two implementations, one fixture — never fork the semantics.
