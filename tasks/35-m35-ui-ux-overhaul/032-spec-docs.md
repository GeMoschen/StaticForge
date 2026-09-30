---
id: M35.32
status: todo
depends: [M35.30, M35.31]
epic: m35-ui-ux-overhaul
feature: closing
area: fullstack
---

# M35.32 — Spec §23/§24 and docs

## Context

User decision 26. `cms-specification.md` §23 (frontend architecture) and §24 (UX), §20 (preferences, dashboard and
record preview endpoints), `docs/user-guide.md`, `docs/architecture.md`, `docs/api.md`.

## Goals

- Rewrite §23 for the design system (tokens, components, overlays, table, tree, splitter), the app frame, state and
  preferences, Transloco, the shortcut registry, and the save/guard/undo contracts.
- Rewrite §24 for the IA (rail groups, Publishing, Settings menu, History), roles and developer mode, identifiers,
  keyboard reference, responsive/review mode, and accessibility.
- `docs/user-guide.md`: new screenshots (from M35.30 baselines) and text for every screen; a keyboard shortcut
  appendix.
- `docs/architecture.md`: frontend section; `docs/api.md`: the new endpoints.
- `tasks/README.md` epic map row for M35 marked with its exit criterion.

## Acceptance criteria

- [ ] No reference to removed UI (spine, Settings → Generation, release bar strip, `window.confirm`) left in the spec
      or docs.
- [ ] `DocsGoldenSnippetsTest` green.
