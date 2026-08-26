# StaticForge E2E journeys

Playwright specs for the twelve §25.6 critical journeys, plus structural accessibility
checks (§24.7). All but the boot-redirect smoke test are gated on `SF_RUN_E2E=1` and
assume a running app at `http://localhost:4200` (`npm start`) proxying `/api` to a
seeded demo backend. The demo seed is still deferred (`db/changelog/data/demo-project.xml`),
so treat the specs as documentation of the intended flow until that seed lands.

## Journey → spec file

| Journeys | Spec file | Milestone |
|---|---|---|
| 1–3 (edit/save, create page + sections, media upload) | `m3-journeys.spec.ts` | M3 |
| 4 (markdown channel + generate both) | `m5-journeys.spec.ts` | M5 |
| 5–8 (UID rename warning, conflict resolver, time travel, referenced-media delete) | `m6-journeys.spec.ts` | M6 |
| 9–12 (required-editor timing, non-member 404, template-IDE 403, keyboard publish) | `m7-journeys.spec.ts` | M7 |
| structural a11y (landmarks/h1/aria-current) + axe-stub | `a11y.spec.ts` | M7 |
| navigation tree + URL registry stability/reset | `m8-journeys.spec.ts` | M8 |
| unauthenticated → login redirect | `example.spec.ts` | — |

## Gating

- `SF_RUN_E2E=1` unblocks journeys 1–12 and the a11y checks; without it they `test.skip`.
- Credentials via `SF_E2E_USER` / `SF_E2E_PASSWORD` (fallback `demo` / `demo`).
- Run a single file: `npx playwright test m7-journeys.spec.ts --list` (collect tests
  without a backend) or `npx playwright test` (needs the app + seed).

## Current honest state

- **Journey 11** asserts the template IDE *absence*: there is no `templates` route or
  IDE component yet, though the nav rail advertises a "Templates" link to an unimplemented
  path. The spec captures this so that adding the IDE later fails the assertion and forces
  the Editor-hiding logic to be revisited.
- **Journey 12** documents that table rows are click-only (no `tabindex`), so keyboard row
  activation is a known gap; the journey exercises the rest of the flow with Tab/Enter.
- `playwright.config.ts` only defines the `chromium` project; firefox/webkit are staged in
  `.github/workflows/e2e.yml` and should be added here to complete the three-browser matrix.
- **`m8-journeys.spec.ts`** documents the intended flow the same way m5/m7 do — it was not run
  against a live browser (no seeded demo backend, no interactive browser in that task's
  environment). The actual proof for `M8.3.1` is `M8NavigationJourneyIntegrationTest`
  (`server/sf-app`), a `@SpringBootTest` that exercises the identical scenario end-to-end via
  real service calls against a real generation pipeline.
