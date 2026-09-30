---
id: M35.31
status: todo
depends: [M35.27, M35.28, M35.29]
epic: m35-ui-ux-overhaul
feature: closing
area: qa
---

# M35.31 — Journeys on the new UI

## Context

User decision 25: journeys are updated once, here, not per screen. `ui/e2e/*journeys*.spec.ts` (m16 onward are
self-seeding; m3–m15 hardcode `localhost:4200` and use outdated selectors). Known pre-existing failures are recorded in
`tasks/todo.md` (M34 review: m20/m21 output checks predate M27 releases; m18, m22, m24, m25 failures).

## Goals

- Shared page objects and helpers for the frame (navigate via the rail or palette, the tree API, the table API,
  confirm, undo, save status), so later UI changes touch one place.
- Update every m16+ journey to the new routes, roles and components.
- Fix the pre-existing failures where the cause is the journey itself (for example release pages before checking
  output).
- Decide per m3–m15 journey whether to port it or delete it because a newer journey covers it; record the decision.
- Add journeys for the new flows: undo delete, unsaved guard, developer mode off hides Develop, palette action "Build
  now", favorites persisting across sessions.

## Acceptance criteria

- [ ] Every kept journey passes against a clean dev backend. List any remaining failure with its cause in
      `tasks/todo.md`.
