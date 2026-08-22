---
id: M1.5.3
status: done
depends: [M1.5.1]
epic: m1-identity-revisions
feature: asset-api
area: backend
---

# M1.5.3 — Page service & API

## Context

Implement the Page asset type (§10) and its §20.2 page endpoints, revision-aware and
payload-validated.

## Goals

- Implement `PageService` + `BodyService` with the §10.3 payload shape (`templateRef`,
  `content`, `bodies` with ordered section instances + stable `instanceId`, `nav`,
  `output`, `meta`).
- Implement page endpoints: list (`?folder/?templateUuid/?q`), create, get (with resolved
  template definition), `PUT` full replace (`If-Match`), `PATCH /content` (merge-patch),
  section add/`order`/delete, `/duplicate`.
- Enforce §10.5 validation: `templateRef` resolves to a non-deleted `PAGE_TEMPLATE`;
  required editors checked at **publish** not save; body content for removed bodies
  retained as orphaned (`content._orphaned`).

## Acceptance criteria

- [ ] Create/list/get/replace round-trip the §10.3 payload with stable `instanceId`s.
- [ ] `PATCH /content` applies a JSON-Merge-Patch as one revision.
- [ ] Section reorder (`PUT …/order`) reorders and diffs per section.

## Out of scope

- CDL-driven *content* validation (M2) — wire structural checks + `templateRef` now,
  leave the CDL validator as an extension point.

## Notes / hazards

- `templateRef` references are by UUID (§5.4), resolved to UIDs only at authoring/render.
