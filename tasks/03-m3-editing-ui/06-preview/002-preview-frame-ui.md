---
id: M3.6.2
status: done
depends: [M3.4.2]
epic: m3-editing-ui
feature: preview
area: frontend
---

# M3.6.2 — Preview frame UI (split view, viewport, highlight)

## Context

Implement §19.3 affordances in the editor.

## Goals

- Embed the sandboxed preview iframe in the split view; draggable divider with persisted
  ratio (§19.3).
- Viewport switcher: mobile 375 / tablet 768 / desktop 1280 / full width.
- Section highlighting: `data-sf-instance` → click in preview focuses the editor form;
  focus in form outlines the section (tiny injected script present only in preview).
- Debounced live preview refresh (400 ms) on edit; `Cmd/Ctrl+Enter` manual refresh.

## Acceptance criteria

- [ ] Divider ratio persists per user; viewport switch resizes the iframe.
- [ ] Clicking a preview section focuses its editor; focusing a field highlights it.

## Out of scope

- Share links (next task).

## Notes / hazards

- The injected highlight script must never ship to production output.
