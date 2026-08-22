---
id: M2.3.4
status: done
depends: [M2.3.3]
epic: m2-templates-rendering
feature: octl
area: backend
---

# M2.3.4 — OCTL validate endpoint & diagnostics

## Context

Expose `POST /projects/{p}/octl/validate` (§20.2) and enforce the §16.11 diagnostic
catalogue.

## Goals

- Implement `POST /octl/validate {source, channelKey, templateUuid}` → diagnostics.
- Implement the §16.11 codes (`SF-TPL-0101…0120` errors, `0201/0301/0310` warnings),
  including `$CMS_BODY in section template` (0120) and body-declared-never-rendered
  (0201).
- Wire the channel-specific escaping context into validation.

## Acceptance criteria

- [ ] The endpoint returns positioned diagnostics matching §16.11 semantics.
- [ ] A `$CMS_BODY` in a section template is flagged (once body context is known).

## Out of scope

- Monaco rendering/markers (M3).

## Notes / hazards

- Warning codes must not abort compile; error codes must.
