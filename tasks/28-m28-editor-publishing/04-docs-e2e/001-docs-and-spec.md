---
id: M28.4.1
status: todo
depends: [M28.2.3, M28.3.3]
epic: m28-editor-publishing
feature: docs-e2e
area: qa
---

# M28.4.1 — Spec and docs

## Context

`cms-specification.md`, `docs/api.md`, `docs/user-guide.md`, `docs/administration.md`, `docs/release-readiness.md`
(G1). Epic "Spec follow-up" list.

## Goals

- Spec: §2.1 G1 (editors can publish when the project allows it), §8.3 (role table: "Generate/publish" for `EDITOR`
  becomes "per project publish policy", a sub-table of the four permissions, what stays `DEVELOPER+`), §8.4
  (`can(projectKey, permission)`, role from token + policy per request, the domain evaluator for schedules),
  §18.1 (trigger table: who may start which run, cancel-own rule, fallback-to-full allowed), §18.5 (`comment`,
  `startedBy`), §20.2 (publish-policy endpoints + impact; changed roles on generation/release/schedule endpoints),
  §24 (Generation tab card, gated controls, scope in the dialog, Build now), §26.3 (audit actions
  `PUBLISH_POLICY_SET`, `GENERATION_STARTED`, `GENERATION_CANCELLED`, `GENERATION_PROMOTED`), Appendix B
  (`SF-API-0403` with `permission`).
- `docs/api.md`: the endpoints, the `permission` problem extension, request rules for editors.
- `docs/user-guide.md`: "Publishing as an editor" (what each toggle allows, where to release, Build now, schedules).
- `docs/administration.md`: choosing a policy per project; impact warning; what developers keep.
- `docs/release-readiness.md`: G1 evidence updated (journey `M28.4.2`).

## Acceptance criteria

- [ ] Every new/changed endpoint in §20.2 with its rule; every new audit action listed.
- [ ] Docs reviewed against the implemented behaviour (not the plan) — deviations recorded in the task notes.

## Out of scope

- Code changes.
