---
id: M30.7.1
status: todo
depends: [M30.1.3, M30.2.1, M30.2.2, M30.2.3, M30.3.1, M30.4.2, M30.5.1]
epic: m30-quality-checks-and-redirects
feature: docs-e2e
area: qa
---

# M30.7.1 — Spec and docs

## Context

`cms-specification.md`, `docs/api.md`, `docs/user-guide.md`, `docs/template-developer-guide.md`,
`docs/administration.md`, `docs/security-review.md`, `infra/README.md` (configuration properties), epic "Spec
follow-up" list.

## Goals

- Spec: §15.2/§10.3 (`nav.noIndex` semantics, `$CMS_META(noIndex)$`), §16.4 (missing link targets render `""` and
  become findings, no longer `SF-GEN-0204`), §18.2 (`CHECK` stage, redirects in POST, fallback causes
  `BASE_BUILD_WITHOUT_QUALITY_FACTS`/`QUALITY_RULES_CHANGED`), §18.4 (`redirectFormats`, `builds/{runId}.quality.json`),
  §18.5 (findings, counts, caps), new §18.7 "Quality checks" (rule catalogue with codes, kinds, params, severity
  effects, no-cascade rule, carried findings), new §18.8 "Redirects" (registry, detection, states, formats, examples),
  §19 (draft checks, section markers only in check renders), §20.2 (quality-rules, findings, draft checks, redirects,
  for-asset), §24 (Issues panel, Quality and Redirects tabs, run findings, unpublish redirect option), §26.3 (SSRF row:
  link checks are internal only — unchanged), Appendix B (`SF-CHK-*` as one row per range plus `SF-CHK-0001`,
  `SF-GEN-0125`, `SF-DOM-0190`–`0194`).
- `docs/api.md`: endpoints, request/response examples, roles, error codes.
- `docs/template-developer-guide.md`: "Passing the quality checks" — what each rule looks for in template markup
  (`<title>`, meta description, one `h1`, `lang="$CMS_META(language)$"`, alt from media, labels), `noIndex` robots meta
  example, why redirect stubs exist.
- `docs/user-guide.md`: the Issues panel, fixing findings (content vs template), the Redirects tab, redirecting on
  unpublish/delete.
- `infra/README.md`: `sf.quality.*` properties; `.htaccess` needs `AllowOverride FileInfo` on Apache; nginx users pick
  HTML stubs.
- Note the URL-registry interplay (assign-once nav hrefs may still point at an old path; redirects make it work).

## Acceptance criteria

- [ ] Every new endpoint in §20.2 with its role; every new code in Appendix B.
- [ ] Rule catalogue in §18.7 generated from or checked against `GET /quality-rules` (a test that fails when a rule has
      no doc row is welcome).
- [ ] Docs reviewed against the implemented behaviour (not the plan) — deviations recorded in the task notes.

## Out of scope

- Code changes.
