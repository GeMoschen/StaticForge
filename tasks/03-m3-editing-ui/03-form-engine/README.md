# Feature: Dynamic form engine

**Spec:** §23.5 (form engine), §14.3 (editor types), §14.4 (attributes).
**Area:** frontend. **Epic:** M3.

## Goal

Build the CDL-driven form engine: `ContentDefinition` → typed form → per-editor control
components, with `visibleWhen`/validation parity to the backend.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-form-builder-registry.md](001-form-builder-registry.md) | M3.2.2 |
| 2 | [002-core-editor-components.md](002-core-editor-components.md) | 1 |
| 3 | [003-rich-media-list-editors.md](003-rich-media-list-editors.md) | 1 |
| 4 | [004-visiblewhen-validation.md](004-visiblewhen-validation.md) | 1, M2.2.1 |

## Feature exit criteria

- [ ] Every editor type in §14.3 renders via the `EDITOR_REGISTRY` (§23.5).
- [ ] `visibleWhen` behaves identically to the backend (shared fixture file).
- [ ] Adding an editor type = one component + one registry entry.

## Dependencies

`M3:project-context`, `M2` (ContentDefinition + shared expression fixture).
