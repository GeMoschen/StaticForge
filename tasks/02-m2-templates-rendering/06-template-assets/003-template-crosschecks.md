---
id: M2.6.3
status: done
depends: [M2.6.2]
epic: m2-templates-rendering
feature: template-assets
area: backend
---

# M2.6.3 — Template cross-checks & body/scope diagnostics

## Context

Enforce the §13.2 cross-check and the §16.11 scope warnings across the template body.

## Goals

- Cross-check `bodies` declarations against `$CMS_BODY` occurrences in every channel
  template; report mismatches (§13.2).
- Flag `$CMS_BODY` in a section template (`SF-TPL-0120`) and body-declared-never-rendered
  (`SF-TPL-0201`), editor-declared-never-used (`SF-TPL-0310`) (§16.11).
- Ensure page payload `bodies` keys ⊆ declared bodies, orphaned otherwise (§10.3).

## Acceptance criteria

- [ ] A declared body with no `$CMS_BODY` usage in any channel is warned.
- [ ] `$CMS_BODY` in a section template is a compile error.

## Out of scope

- Navigation/structure cross-checks (M5).

## Notes / hazards

- Orphaned body content is retained + flagged, never dropped (§10.3).
