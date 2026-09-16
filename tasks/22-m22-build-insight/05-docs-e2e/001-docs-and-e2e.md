---
id: M22.5.1
status: todo
depends: [M22.3.1, M22.3.2, M22.4.1]
epic: m22-build-insight
feature: docs-e2e
area: qa
---

# M22.5.1 — Build insight docs + E2E journey

## Context

After `M22.1`–`M22.4`: plans carry reason chains, are stored per run, can be dry-run,
asset impact is available, and incremental runs publish a complete site with a
per-target baseline. Playwright journeys live in `ui/e2e/` (e.g. `m15-journeys.spec.ts`);
per `M15.6`, journeys have historically been collected but not run for lack of a seeded
live backend. See the memory note on running StaticForge locally for the dev login and
ports.

## Goals

- **E2E journey** `ui/e2e/m22-journeys.spec.ts`:
  1. Seed: a project with a target, a page template, a section template `teaser` used on
     3 of 5 pages, and a media file used on 1 page.
  2. Run a full generation (baseline).
  3. Edit `teaser`. Open the generation dialog, choose Incremental and preview: 3
     pages × channels, each chain `page ← section_template:teaser`.
  4. Start the run. The run's "Rebuilt pages" tab lists the same entries.
  5. Open the published output (filesystem target): all 5 pages are present and the
     sitemap lists all 5. This is the regression check for `M22.4.1`.
  6. Open the media drawer and expand Impact: 1 page, edge "references media".
  7. Open a second target with no builds and preview Incremental: a fallback-to-full
     warning is shown.
- **Backend journey test** (JUnit, runs in CI regardless of Playwright): the same
  scenario through the REST API, asserting the preview, run plan and published file set.
- **Docs:**
  - `cms-specification.md`:
    - §18.2: reason chains, navigation rule as implemented, incremental carry-forward.
    - §18.4: incremental staging.
    - §18.5: `plan_summary` + plan tables.
    - §20.2: new endpoints.
  - `docs/api.md`: `POST /generations/plan`, `GET /generations/{runId}/plan`,
    `GET /assets/{uuid}/impact`.
  - `docs/user-guide.md`: "Why is this rebuilding?" for generation dialog preview, run
    tab and Impact panel.
  - `docs/architecture.md` §6: `RebuildExpansion` shared by planner, dry run and impact.
  - ADR-0005 note on incremental staging (if not already done in `M22.4.1`).
  - `tasks/README.md` epic map row status.
- **Benchmark:** extend the existing 5,000-page benchmark to report the PLAN stage
  with reasons and plan persistence time, plus incremental carry-forward time. Record
  the numbers in this task.

## Acceptance criteria

- [ ] Backend journey test passes in `./gradlew build`.
- [ ] Playwright journey exists and passes against a live backend, or its
      non-execution is documented with the exact reason.
- [ ] Published output check (all pages + complete sitemap after incremental) is part
      of both journeys.
- [ ] Docs listed above updated and consistent with the shipped API (field names match
      `schema.d.ts`).
- [ ] Benchmark numbers recorded; PLAN stage overhead < 10 %, §18.6 incremental targets
      met.

## Out of scope

- Journeys for reason edges added by `M17`–`M21`; each of those epics extends this
  journey for its own asset types.

## Notes / hazards

- The live-backend Playwright run needs a seeded user. Reuse the dev-profile login
  rather than adding production seed data.
- Compare published output via the target directory on disk in the backend test; the
  Playwright journey can check via the preview/share or a static file server if one is
  configured.
