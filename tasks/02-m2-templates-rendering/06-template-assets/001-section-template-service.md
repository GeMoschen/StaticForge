---
id: M2.6.1
status: done
depends: [M2.1.3, M2.3.3]
epic: m2-templates-rendering
feature: template-assets
area: backend
---

# M2.6.1 — Section template service & API

## Context

Implement the section template asset (§12): CDL + per-channel OCTL + migration.

## Goals

- Implement `TemplateService` for section templates with the §12.1 payload
  (`contentDefinition`, `compiledDefinition`, `channelTemplates` w/ `compiledHash`,
  `preview`, `category`, `deprecated`).
- Implement channels edit: `PUT/DELETE …/channels/{channelKey}` (§20.2).
- Implement CDL-change content migration: `renamedFrom` hint moves `old` → `new` for
  every instance project-wide in one revision, recorded in the summary (§12.3).
- Enforce §12.2: editor-name uniqueness, orphaned-value preservation
  (`content._orphaned`), `deprecated` hides from picker.

## Acceptance criteria

- [ ] Creating/updating a section template compiles CDL + each channel template.
- [ ] A rename + `renamedFrom` migrates all instances in one revision.
- [ ] Removed editors leave orphaned values surfaced, not dropped.

## Out of scope

- UI (M3). "Required channel" behavior (M5 channels).

## Notes / hazards

- Never destroy stored content on CDL change (§12.2).
