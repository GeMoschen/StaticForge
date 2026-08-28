import { test, expect, Page } from '@playwright/test';

/**
 * M15 closing journey (feature `e2e-verification`, `M15.6.1`, §25.6 journey 1/6/7):
 * proves the epic's headline promise browser-side — creating a project through the real
 * UI produces exactly **one** revision (not the pre-M15 eight), with the asset-count
 * affordance (`M15.4`) showing on both the history list and revision spine, and that
 * revision's diff view listing every bootstrap folder as a `CREATE` entry.
 *
 * Unlike m3/m5/m6/m7/m8/m13, this journey creates a *new* project rather than reusing
 * the seeded demo project, so it additionally needs the logged-in user to hold
 * `INSTANCE_ADMIN` (`DashboardComponent.isAdmin()` gates the "New project" button) —
 * the same seeded demo user other journeys already assume is privileged enough to
 * reach admin-only surfaces (e.g. m13's Templates folder-tree journey).
 *
 * Prerequisites (not yet provisioned — see `ui/e2e/README.md`), mirroring m3/m5/m6/m7/m8/m13:
 *   - Backend running (Spring Boot, `demo` profile) with a seeded demo admin user.
 *   - `npm start` (ng serve) on http://localhost:4200 proxying /api to the backend.
 * The demo seed is still deferred, so — exactly like m5/m6/m7/m8/m13 — this spec is
 * gated on `SF_RUN_E2E` and documents the intended flow rather than having been run
 * against a live browser here. The actual proof for this milestone's backend behavior
 * is `ProjectApiIntegrationTests.createAllocatesRevisionOneAndGrantsCreatorProjectAdmin`
 * (`server/sf-app`), a `@SpringBootTest` that exercises the identical scenario
 * end-to-end via real service calls.
 */
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

/** Unique per run so re-running this journey against a live backend never 409s on a
 * reused key (`ProjectServiceImpl.create` rejects a duplicate key with 409). */
const PROJECT_KEY = `e2e-m15-${Date.now()}`;
const PROJECT_NAME = 'M15 E2E Project';

/** Project creation touches: the project itself + the shared hidden root + "All
 * Templates" + "Page Templates" + "Section Templates" + "All Navigation" + "All Pages"
 * + "All Media" — 1 PROJECT entry and 7 FOLDER entries (spec M13.1.2's fixed folders),
 * per `ProjectApiIntegrationTests.createAllocatesRevisionOneAndGrantsCreatorProjectAdmin`.
 */
const EXPECTED_ASSET_COUNT = 8;
/** The diff view only ever resolves entries with a real `Asset` row — the synthetic
 * "project-<id>" summary entry (`ProjectServiceImpl.create`) isn't a UUID, so
 * `DiffServiceImpl.diffEntry` silently skips it, leaving only the 7 bootstrap folders. */
const EXPECTED_DIFF_ASSET_COUNT = 7;

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('sf-login input[name="username"]').fill(USER);
  await page.locator('sf-login input[name="password"]').fill(PASSWORD);
  await page.locator('sf-login button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
}

test('journey: project setup produces exactly one revision with an 8-asset affordance', async ({
  page,
}) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);

  // 1. Create the project through the real dashboard flow.
  await expect(page.locator('sf-dashboard')).toBeVisible();
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('input[formControlName="key"]').fill(PROJECT_KEY);
  await page.locator('input[formControlName="name"]').fill(PROJECT_NAME);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText('Project created')).toBeVisible({ timeout: 10_000 });

  // 2. History list: exactly one revision, showing the asset-count affordance.
  await page.goto(`/p/${PROJECT_KEY}/settings/revisions`);
  await expect(page.locator('sf-revisions-list')).toBeVisible();
  const rows = page.locator('sf-revisions-list .revisions__row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.revisions__type')).toHaveText('CREATE');
  await expect(rows.first().locator('.revisions__summary')).toContainText(
    `${EXPECTED_ASSET_COUNT} assets`,
  );

  // 3. Revision spine: exactly one tick, same asset-count affordance in its label.
  const dots = page.locator('sf-revision-spine .spine__dot');
  await expect(dots).toHaveCount(1);
  await expect(dots.first().locator('.spine__label')).toContainText(
    `${EXPECTED_ASSET_COUNT} assets`,
  );

  // 4. Open the single revision's diff view: the 7 resolvable bootstrap folders (the
  // project's own synthetic summary entry isn't a real Asset, so DiffServiceImpl skips
  // it — see EXPECTED_DIFF_ASSET_COUNT above) all show as CREATE entries.
  await rows.first().click();
  await expect(page.locator('sf-revision-diff')).toBeVisible();
  const diffAssets = page.locator('sf-revision-diff .diff__asset');
  await expect(diffAssets).toHaveCount(EXPECTED_DIFF_ASSET_COUNT);
  const assetTypes = page.locator('sf-revision-diff .diff__asset-type');
  const count = await assetTypes.count();
  for (let i = 0; i < count; i++) {
    await expect(assetTypes.nth(i)).toContainText('CREATE');
  }
});
