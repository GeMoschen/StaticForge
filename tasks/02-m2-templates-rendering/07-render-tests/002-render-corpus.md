---
id: M2.7.2
status: done
depends: [M2.5.1, M2.7.1]
epic: m2-templates-rendering
feature: render-tests
area: qa
---

# M2.7.2 — Rendering corpus & XSS escaping set

## Context

Seed the golden-file corpus from the §25.4 list and, critically, the injection corpus.

## Goals

- Add directories: `value-basic`, `value-filters`, `if-elseif-else`, `for-list-nested`,
  `ref-page-relative`, `ref-media-variant`, `body-multiple`, `nav-recursive` (nav deferred
  to M5 but scaffolded), `escaping-xss`.
- Build `escaping-xss` with the injection corpus (`<script>`, `" onload=`,
  `javascript:`, unicode escapes, nested entities); assert **absence** of executable
  output everywhere (§25.4).

## Acceptance criteria

- [ ] The full corpus renders correctly with no regressions.
- [ ] The `escaping-xss` cases render with every value escaped (or `raw`-gated).

## Out of scope

- `nav-recursive` real content until M5 (leave placeholder).

## Notes / hazards

- This corpus is the safety net for §16.1 "safe by default" — treat it as sacred.
