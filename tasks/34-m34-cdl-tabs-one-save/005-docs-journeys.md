---
id: M34.5
status: done
depends: [M34.4]
epic: m34-cdl-tabs-one-save
feature: docs
area: fullstack
---

# M34.5 — Spec, docs and journeys

## Goals

- Spec §12.1, §13.2, §14.1, new §14.9, §20.2, §23.7; `docs/api.md`, `docs/architecture.md`,
  `docs/template-developer-guide.md`, `docs/user-guide.md`.
- Journeys send the sections (`e2e/cdl.ts` splits a whole CDL text) and use the tabs and the one Save; m17 journey 3
  signs in as a real editor account (an instance admin is a project admin whatever its membership).

## Acceptance criteria

- [x] No `contentDefinition` left in code, docs or journeys.
