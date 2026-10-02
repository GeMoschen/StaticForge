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

## Design gate (M35.9)

Before starting, read the signed-off design gate in `009-style-guide-gate.md` — the user decisions and every review
round — and the sample screen at `/styleguide`. Build this task to match them; where this task and the signed-off gate
differ, the gate wins. Note any deviation you need in this file and get it approved.

**Sample first (user rule, 2026-10-02).** If this task needs a screen, state or decision that the sample at `/styleguide`
does not cover (or covers differently), do **not** implement it. Add it to the sample first, tell the user, and wait
for their review and sign-off; record the decisions in `009-style-guide-gate.md`. Only then build it in the app.

## Acceptance criteria

- [ ] No reference to removed UI (spine, Settings → Generation, release bar strip, `window.confirm`) left in the spec
      or docs.
- [ ] `DocsGoldenSnippetsTest` green.

## Notes (M35.9)

- M35.9's decisions 1-34 (frame look, rail widths, product mark, cards and catalogs, trees with sibling reordering,
  Publishing and Settings sub-navigation, full-width editors, release-action grouping) are the source for §23/§24;
  carry them into the spec. The living style guide at `/styleguide` is part of the documented frontend.
