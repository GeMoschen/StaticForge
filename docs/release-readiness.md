# StaticForge CMS — Release readiness (final acceptance)

Final acceptance against `cms-specification.md` §2.1 (goals G1–G6) and §27 (M0–M7 exit criteria). Each goal is mapped to the evidence that exists in the repository today, and each exit criterion is marked **proven** (a passing automated check exercised in CI / committed) or **gated** (a check exists but is not yet wired into an always-on CI/nightly job, or an E2E journey authored but skipped pending a seeded demo backend).

## 1. Goals (G1–G6)

### G1 — Editors publish page changes without developer help

**Measure:** time-to-publish for a text change < 2 min.

- **Evidence (authoring path):** the editor-facing API is fully revisioned and field-level — `PATCH /projects/{p}/pages/{uuid}/content` (JSON-Merge-Patch) plus `BodyService` (`AddSectionRequest`, `ReorderRequest` in `sf-api.dto`) for sections. Autosave/revision semantics are covered by `AssetRevisionIntegrationTests` and `RevisionInvariantsTest` (spec §25.5).
- **Evidence (publish path):** generation is a self-service `POST /generations` (role DEVELOPER/PROJECT_ADMIN), covered by `GenerationIntegrationTest`; `FilesystemTargetWriter` performs atomic staged publish.
- **Gap:** no end-to-end wall-clock measurement of "text change → publish < 2 min" exists. The constituent operations are tested in isolation; the E2E journey that strings them together (Journey 1, `ui/e2e/m3-journeys.spec.ts`) is authored but gated.

### G2 — Every change is attributable and reversible

**Measure:** 100% of mutations carry revision + author.

- **Evidence (attribution + reversibility):** `RevisionInvariantsTest` (jqwik property-based) asserts gapless consecutive revision ids, exactly one valid `AssetVersion` per (asset, revision), byte-identical point-in-time reads, and restore correctness. `ConcurrentWritersTest` (16 virtual threads) asserts the total order with no lost updates. `RevisionServiceImpl`/`RevisionCounterRepository`/`JdbcRevisionCounterRepository` implement allocation; `ProjectRestoreService` implements rollback.
- **Status:** **proven** at the unit/slice level. The `@RevisionAware` ArchUnit rule (complementing the `checkModuleLayers` graph guard) enforces that no write path bypasses revisioning.

### G3 — One content set, many output formats

**Measure:** HTML + Markdown from identical content.

- **Evidence:** the `markdown` channel and the per-channel OCTL template model are implemented (`OutputChannel`, `ChannelServiceImpl`, `ChannelTemplateDto`). Golden-file render tests cover both channels: `GoldenFileRenderTest` (HTML, `src/test/resources/render/`) and `MarkdownChannelGoldenTest` (`src/test/resources/render-md/` — `section-markdown`, `filters-md-plain`). `PostProcessStage`/`HtmlPrettyPrintProcessor` handle per-channel post-processing.
- **Status:** **proven** via golden tests for both channels.

### G4 — Developers model content declaratively

**Measure:** new content type live without backend deploy.

- **Evidence:** CDL is authored as data and compiled at runtime — `CdlCompiler`/`CdlValidator` (`CdlCompilerTest`), `TemplateService` (`TemplateServiceTest`), and `POST /cdl/validate`. The Angular form engine renders any `ContentDefinition` without code changes (`ui/src` form engine; `expression-evaluator.spec.ts` shares fixtures with the backend evaluator).
- **Status:** **proven** (CDL compilation + validation + dynamic form all exercised). "Live without deploy" is a consequence of the declarative design and is not itself a separate check.

### G5 — Generation of a 5,000-page project completes predictably

**Measure:** full build < 5 min, incremental < 10 s.

- **Evidence (correctness):** `GenerationServiceTest`, `BuildPlanner`, `RenderPipeline`, `OutputPathResolverTest`, `FilesystemTargetWriterTest`, and `NavGoldenTest` cover planning, rendering, path resolution, and atomic publish.
- **Gap:** the **5,000-page performance fixture and JMH/Gatling benchmark** described in §18.6/§25.1 is not present in CI (the CI workflow is currently the skeleton `./gradlew build` + `npm test` only). This is called out as a nightly in spec §25.1 and is **gated**, not proven. Target numbers (§18.6) remain spec assertions pending the bench harness.

### G6 — Editing UI is fast, accessible, keyboard-driven

**Measure:** WCAG 2.2 AA verified, core flows keyboard-complete.

- **Evidence (structure):** the UI implements keyboard-complete flows (`Alt+↑/↓` reorder, command palette, keyboard alternatives documented in spec §23.6/§24.6), design tokens with 7:1 contrast pairs (§24.3), and reduced-motion support (`prefers-reduced-motion`).
- **Evidence (automated):** 8 frontend unit specs (`ui/src/**/*.spec.ts`) cover form-engine expression evaluation, SSE, conflict resolution, and shared components.
- **Gap:** the axe-core a11y sweep and manual NVDA/VoiceOver pass are **not** wired into CI yet (no `@axe-core/playwright` job is defined in `.github/workflows/ci.yml`). Accessibility is claimed by design (§24.7) but **gated** pending the a11y gate in §25.7. See the honest note in the task `tasks/07-m7-hardening/06-docs/002-final-acceptance.md`.

## 2. Milestone exit criteria (M0–M7)

| Milestone | Criterion | Status |
|---|---|---|
| **M0** | `docker compose up` yields a running empty app; pipeline green | **Proven.** `infra/docker/docker-compose.yml` (Postgres + backend + nginx) with healthcheck-gated startup; `infra/README.md` documents `docker compose up`. CI green on skeleton build. |
| **M1** | Property-based revision invariants pass; login → project → folder works | **Proven.** `RevisionInvariantsTest`, `AuthIntegrationTests`, `ProjectApiIntegrationTests`, `SecuritySmokeTests`, `AssetRevisionIntegrationTests`. |
| **M2** | Golden-file suite green; a page renders end-to-end via API | **Proven.** `GoldenFileRenderTest` + `MarkdownChannelGoldenTest` + `RendererTest`; generation integration test renders end-to-end. |
| **M3** | Journeys 1–3 pass in Playwright | **Gated.** Journeys 1–3 authored in `ui/e2e/m3-journeys.spec.ts`, skipped unless `SF_RUN_E2E=1` (needs seeded demo backend; the `demo` seed was deferred in M1). |
| **M4** | 5,000-page fixture within target; rollback works | **Gated (rollback proven).** Atomic publish + promote implemented and tested (`FilesystemTargetWriterTest`, `GenerationServiceTest`); the 5,000-page benchmark is not yet run. |
| **M5** | Journey 4 passes; two channels from one content set | **Markdown channel proven** (golden tests); **Journey 4 gated** (authored, `SF_RUN_E2E`). |
| **M6** | Journeys 5–8 pass | **Gated.** Journeys 5–8 authored in `ui/e2e/m6-journeys.spec.ts` (`SF_RUN_E2E`); underlying logic unit-tested (`conflict-util.spec.ts`, `UidChangeWarningIntegrationTest`). |
| **M7** | Quality gates §25.7 met; pen-test findings closed | **Partly gated.** Layering + spotless + test suite run in CI; coverage thresholds, axe zero-violation, OWASP, and Liquibase-drift gates are specified (§25.7) but not yet enforced in `.github/workflows/ci.yml`. |

## 3. Summary

Goals G2, G3, and G4 are **proven** by committed automated tests. G1 and G5 need honest, time-boxed performance/E2E evidence that is not yet captured in an always-on job; G6 (a11y) is claimed by design and partially unit-tested but needs the axe + manual screen-reader pass from §24.7. All 12 critical journeys of §25.6 are authored; those that exercise the seed-dependent UI are gated behind `SF_RUN_E2E` rather than missing.

**Recommendation:** promote the spec's promised nightly jobs (PostgreSQL dialect, 5,000-page benchmark, axe sweep) into `.github/workflows/` and run the a11y/manual pass before declaring M7 fully met. This is deliberately not done by the documentation agent — those gates are owned by other agents.
