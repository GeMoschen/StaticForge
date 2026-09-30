---
id: M35.9
status: todo
depends: [M35.6, M35.7, M35.8]
epic: m35-ui-ux-overhaul
feature: design-system
area: frontend
---

# M35.9 — Style guide and design gate

## Context

User decisions 24 and 25. This is a **hard gate**: no screen migration (M35.10 onward) starts before the user signs
off this task.

## Goals

- An in-app living style guide at `/styleguide`, visible to instance admins or in dev builds only. It shows:
  - Tokens: colours with contrast values, type scale, spacing, radius, elevation, z-index.
  - Every component from M35.6–M35.8 in all states, with a theme switch (light/dark) and a density switch
    (compact/comfortable).
- **One sample screen** built only from the components: a static mockup of the new frame with the Pages tree, a folder
  table and the page editor with its form and preview, using fake data.
- Screenshots of the style guide and the sample screen in light/dark × compact/comfortable at 1440 and 1024, shared
  with the user.

## Acceptance criteria

- [ ] The user has reviewed the screenshots (or the running page) and **signed off**. Record the date and any
      requested changes below, and apply them before setting `done`.
- [ ] `npx vitest run` and `npx ng build` green.

## Notes / hazards

- Sign-off:
