---
id: M30.7.1
status: in-progress
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
- [x] Rule catalogue in §18.7 generated from or checked against `GET /quality-rules` (a test that fails when a rule has
      no doc row is welcome). — §18.8 (see notes); `QualityRuleCatalogTest.theSpecificationCataloguesEveryRuleAsRegistered`.
- [ ] Docs reviewed against the implemented behaviour (not the plan) — deviations recorded in the task notes.

## Out of scope

- Code changes.

## Notes / hazards

- **Progress (2026-09-27):** documented against the merged code of phase B (`c8f29b3`): spec §10.3, §15.2, §16.2,
  §16.4, §18.2, §18.4, §18.5, new §18.8/§18.9, new §19.4, §20.2, §21.6, §24.5 (items 18–19), §26.3, §26.5, Appendix B;
  `docs/api.md` (§3 table and import paragraph, new §3.5, §5, §9, §10 + new §10.2/§10.3, §12, §15),
  `docs/template-developer-guide.md` (§2.1 `CMS_META`, new §2.14, §3.3, new §3.5), `docs/user-guide.md` (page
  properties, new "Quality checks and issues" and "Redirects" sections, generate log), `infra/README.md`
  (`sf.quality.*`, "Serving redirects"), `docs/administration.md` (audit actions), `docs/security-review.md` (SSRF,
  path traversal, metrics), `docs/navigation-html-output.md` (URL registry interplay). Stays `in-progress`: the draft
  checks (M30.3.1/M30.3.2), the Quality tab (M30.6.1), the run findings UI (M30.6.2) and the target form's redirect
  checkboxes (rest of M30.6.3) are documented from their task files and every such sentence carries an
  `<!-- M30-VERIFY: … -->` comment; check each against the merged code, then drop the comments.
- Test: `QualityRuleCatalogTest.theSpecificationCataloguesEveryRuleAsRegistered` parses the §18.8 table of
  `cms-specification.md` (found upwards from the working directory) and compares code set, name, category, kind,
  fix hint, parameter defaults and maximum severity with the registry; proven failing on a renamed row.
- Deviation: §18.7 is the M27 Scheduler, referenced from many places, so the new sections are **§18.8 Quality checks**
  and **§18.9 Redirects**; draft checks got **§19.4**. The epic's "§15.2 (`noIndex`)" went to §10.3 (the page payload,
  where `nav` lives); §15.2 got the "HTML channels" note instead.
- Deviation (as implemented, not as planned): export protocol **10** and changelogs `028`/`029`; `.htaccess` uses
  anchored `RedirectMatch 301` with a regex-escaped decoded source, a directory source also matching its index file
  (decision 18 amended 2026-09-27); redirect state `LOOP`; site files never shadow a redirect in the registry view (a
  build still never writes a redirect over its own site files); `fixHint` and `maxSeverity` per rule (`SF-CHK-0001`
  is filed under `LINKS` and capped at warning like `0103`/`0210`); `CMS_META.` expression root; `nav.noIndex` edited
  next to `nav.visible`; every planned-but-unpublished page output (not only quality hold-backs) leaves sitemap and
  search index; `redirects.json` is written only with the `JSON` format (never written before M30); `PUT
  /quality-rules` replaces the whole configuration; `PUT` of an `AUTO` redirect makes it `MANUAL`; `GET /redirects`
  has a `state` filter and its own page envelope (`rows`, `basisRunId`); dry run `redirectsActive` is `null`.
- Documented observation (M30.4.2): changing a folder's UID doesn't change its pages' output paths (folder path is
  materialized at placement), so only moves produce AUTO redirects.
- Found, not changed (docs-only task): the javadoc of `RedirectFormat.HTACCESS` still says "`Redirect 301` lines"; the
  code writes `RedirectMatch 301`. M30.7.2's journey step 6 also still expects "the `Redirect 301` line".
