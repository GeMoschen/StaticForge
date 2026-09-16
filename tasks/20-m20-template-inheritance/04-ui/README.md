# Feature: UI (template IDE support for inheritance)

**Spec:** Extends §23.7 (template IDE), §24.6 (errors carry the fix).

## Goal

Make inheritance visible and safe to author in the existing template screen
(`ui/src/app/features/templates/`, plain `<textarea>` editors):

- Abstract toggle.
- Parent chain display.
- Read-only inherited editors and bodies.
- Live OCTL diagnostics per channel from a context-aware validate endpoint. Today the UI never calls
  `POST /octl/validate`, and that endpoint compiles without a resolver or content definition.
- Abstract templates excluded from page-creation and template-switch pickers.
- Parent-save rejections/warnings about descendants shown with links to the affected templates.

## Tasks (in order)

| # | Task | Depends |
|---|---|---|
| 1 | [001-template-ide-inheritance.md](001-template-ide-inheritance.md) | `M20.2.2`, `M20.3.1` |

## Feature exit criteria

- [x] A developer can build a three-level chain entirely in the UI, seeing inherited editors and live
      diagnostics, and an editor can only create pages on non-abstract templates.

## Dependencies

`M20.2.1`/`M20.2.2` (API fields, 422 shapes), `M20.3.1` (preview renders chains).
