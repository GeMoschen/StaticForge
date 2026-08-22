---
id: M3.3.1
status: done
depends: [M3.2.2]
epic: m3-editing-ui
feature: form-engine
area: frontend
---

# M3.3.1 — Form builder & editor registry

## Context

Implement §23.5's core: `FormBuilderService` building a typed `FormGroup` mirroring the
editor tree, plus the `EDITOR_REGISTRY` mapping.

## Goals

- Implement `FormBuilderService.build(definition, value)` → typed form group.
- Implement `<sf-content-form [definition] [formGroup]>` iterating editors.
- Implement `EDITOR_REGISTRY: Map<EditorType, Type<EditorComponent>>` and the
  `EditorComponent { definition; control }` interface (§23.5).
- Handle `group` recursion and `list` nesting.

## Acceptance criteria

- [ ] A `ContentDefinition` builds a correct nested form group.
- [ ] Adding a new editor type requires only one component + one registry entry.

## Out of scope

- Individual editor implementations (next tasks).

## Notes / hazards

- Build on typed reactive forms; keep control value shapes matching §14.3.
