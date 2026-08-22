---
id: M2.1.3
status: done
depends: [M2.1.2]
epic: m2-templates-rendering
feature: cdl
area: backend
---

# M2.1.3 — CDL validator & ContentDefinition

## Context

Third stage of §14.7: semantic validation producing the normalized JSON
`ContentDefinition` and a diagnostic list.

## Goals

- Implement semantic validation: editor-name uniqueness within a template (§14.2/§14.5),
  `list … item` namespace scoping, reserved-name rejection (`uid`, `uuid`, `type`,
  `template`, `bodies`, `nav`, `meta`, `_orphaned`), attribute correctness per type
  (§14.4), `visibleWhen` expression grammar check, `validate` clauses.
- Emit the normalized JSON AST (§14.1) with `code`-tagged diagnostics
  (`(line, col, severity, code, message)`).
- Enforce naming rules `[a-zA-Z][a-zA-Z0-9_]{0,63}`.

## Acceptance criteria

- [ ] Duplicate editor names across groups are rejected with line/col.
- [ ] Reserved names rejected; list-item names scoped correctly.
- [ ] Output `ContentDefinition` matches the documented normalized shape.

## Out of scope

- `visibleWhen` *evaluation* (feature 2 owns the evaluator; here only grammar-check).

## Notes / hazards

- The same normalized JSON must be consumable by the frontend form engine (M3).
