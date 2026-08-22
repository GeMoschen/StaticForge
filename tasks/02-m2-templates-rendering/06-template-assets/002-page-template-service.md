---
id: M2.6.2
status: done
depends: [M2.6.1]
epic: m2-templates-rendering
feature: template-assets
area: backend
---

# M2.6.2 — Page template service & API

## Context

Implement the page template asset (§13): CDL editors **plus** bodies + output-path rules.

## Goals

- Implement page templates with the §13.2 payload: `bodies` (name/label/`allow`/min/max),
  `outputPath` per channel, `contentDefinition`, `channelTemplates`.
- Implement page template endpoints (§20.2) and the body `allow` list resolution
  (section-template UIDs → UUIDs at compile time, or `"*"`).
- Implement `outputPath` placeholder expansion rules (§18.3 relevant literals):
  `{folder}`, `{uid}`, `{ext}`, `{displayNameSlug}`, `{year}`, `{month}`, `{day}`,
  `{channel}`.

## Acceptance criteria

- [ ] A page template declares bodies explicitly; `allow` lists enforce allowed section
      templates (§10.5).
- [ ] `outputPath` expressions expand with the §18.3 placeholders.

## Out of scope

- Actual output-path *resolution to files* (M4, uses the same expansion).

## Notes / hazards

- Bodies are authored explicitly (§13.2), not inferred from OCTL.
