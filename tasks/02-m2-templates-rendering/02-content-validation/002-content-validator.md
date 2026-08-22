---
id: M2.2.2
status: done
depends: [M2.1.3, M2.2.1]
epic: m2-templates-rendering
feature: content-validation
area: backend
---

# M2.2.2 — Content validator

## Context

Validate stored content against a `ContentDefinition`, honoring §10.5 save-vs-publish
semantics and §14.4 attributes.

## Goals

- Implement `ContentValidator` checking `required`, `maxLength`, `maxChars`, `min/max`
  (list), `mimeTypes`/`minWidth` (media), `pattern … message`, options (select), and
  type-specific value shapes (§14.3).
- Implement severity split: structural validity allows save; `ERROR` findings block
  publish and are listed (§10.5).
- Evaluate `visibleWhen` (using the evaluator) to conditionally require/validate.

## Acceptance criteria

- [ ] A missing required editor does not block save but blocks publish with a list.
- [ ] `validate pattern …` returns the declared `message`.
- [ ] Value shapes per §14.3 types are enforced (media refs, links, lists).

## Out of scope

- Publishing *flow* (M4) calls this; here the validator itself.

## Notes / hazards

- Orphaned values (removed editors) must be preserved, not rejected (§12.2).
