---
id: M3.3.2
status: done
depends: [M3.3.1]
epic: m3-editing-ui
feature: form-engine
area: frontend
---

# M3.3.2 — Core editor components

## Context

Implement the "simple" editor controls from §14.3.

## Goals

- Implement `SfTextEditor`, `SfTextareaEditor`, `SfNumberEditor`, `SfBooleanEditor`,
  `SfDateEditor`/`SfDateTimeEditor`, `SfSelectEditor` (radio ≤4 / listbox), 
  `SfMultiselectEditor`, `SfColorEditor` (palette-constrained), `SfLinkEditor`
  (dialog: INTERNAL/EXTERNAL/MEDIA/ANCHOR/MAIL).
- Wire `label`, `help`, `required`, `default`, `readOnly`, `hidden`, `group`, `order`.
- Add validation-message rendering from definition (`validate … message`) with i18n
  fallback (§23.5).

## Acceptance criteria

- [ ] Each control renders and binds to its §14.3 value shape.
- [ ] `select` switches between radio group and listbox at the 4-option threshold.

## Out of scope

- Rich/media/list/group/json (next task).

## Notes / hazards

- Reuse `shared/components` from M0 (`sf-field`).
