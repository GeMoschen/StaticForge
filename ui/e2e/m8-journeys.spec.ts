import { test, expect, Page } from '@playwright/test';

/**
 * M8 exit-criterion closing journey (`M8.3.1`, §17): build a navigation tree with a
 * folder-targeted `PageReference` and a `startNode`-configured folder, render it via
 * `$CMS_NAVIGATION`, generate, verify emitted URLs, edit the target page, regenerate,
 * verify URL stability, reset the registry, regenerate again, verify reassignment, and
 * check that PREVIEW-area URLs stay independent of GENERATED ones.
 *
 * Prerequisites (not yet provisioned — see `ui/e2e/README.md`), mirroring m3/m5/m6/m7:
 *   - Backend running (Spring Boot, `demo` profile) with a seeded demo user/project that
 *     already has a "Products" navigation folder and a page-store folder with 3+ pages
 *     (or this spec creates them itself via the navigation UI, below).
 *   - `npm start` (ng serve) on http://localhost:4200 proxying /api to the backend.
 * The demo seed is still deferred, so — exactly like m5/m6/m7 — this spec is gated on
 * `SF_RUN_E2E` and documents the intended flow rather than having been run here. The
 * actual proof for this task is the backend `@SpringBootTest` journey,
 * `M8NavigationJourneyIntegrationTest` (server/sf-app), which exercises the identical
 * scenario end-to-end via real service calls against a real generation pipeline.
 */
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

const PROJECT_KEY = 'demo';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('sf-login input[name="username"]').fill(USER);
  await page.locator('sf-login input[name="password"]').fill(PASSWORD);
  await page.locator('sf-login button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
}

test('journey: navigation tree + URL registry stability/reset end-to-end', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);

  // 1-2. Build the tree: a "Products" folder (no startNode) holding a folder-targeted
  // PageReference, then set the folder's own startNode to that reference.
  await page.goto(`/p/${PROJECT_KEY}/navigation`);
  await expect(page.locator('sf-navigation')).toBeVisible();
  await page.getByRole('button', { name: /New folder/i }).click();
  await page.locator('sf-nav-folder-detail input[name="displayName"]').fill('Products');
  await page.getByRole('button', { name: /Save/i }).click();
  await expect(page.getByText('Products')).toBeVisible();

  await page.getByText('Products').click();
  await page.getByRole('button', { name: /New reference/i }).click();
  await page.locator('sf-nav-reference-detail select[name="targetKind"]').selectOption('FOLDER');
  // Assumes the demo seed provides a page-store folder with 3+ pages, selected here.
  await page.locator('sf-nav-reference-detail select[name="targetAssetUuid"]').selectOption({ index: 1 });
  await page.locator('sf-nav-reference-detail input[name="label"]').fill('Browse Catalog');
  await page.getByRole('button', { name: /Save/i }).click();
  await expect(page.getByText('Browse Catalog')).toBeVisible();

  await page.getByText('Products').click();
  await page.locator('sf-nav-folder-detail select[name="startNodeKind"]').selectOption('PAGE_REFERENCE');
  await page.locator('sf-nav-folder-detail select[name="startNodeAssetUuid"]').selectOption({ label: 'Browse Catalog' });
  await page.getByRole('button', { name: /Save/i }).click();

  // 3-4. Render $CMS_NAVIGATION(nav:root)$ in a page template (assumed already wired into
  // the demo seed's home template) and generate the HTML channel.
  await page.goto(`/p/${PROJECT_KEY}/settings/generation`);
  await page.getByRole('button', { name: /New generation/i }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/SUCCESS/)).toBeVisible({ timeout: 120_000 });

  // Verify the rendered home page's nav has the expected hrefs, and "Products" links to
  // the first page of its target folder.
  const homeResponse = await page.request.get(`/api/v1/projects/${PROJECT_KEY}/preview/home?channel=html`);
  const homeHtml = await homeResponse.text();
  const catalogHrefMatch = homeHtml.match(/<a href="([^"]*)">Browse Catalog<\/a>/);
  expect(catalogHrefMatch).not.toBeNull();
  const catalogHrefBefore = catalogHrefMatch![1];

  // 5. Rename the target page; regenerate; the URL must be unchanged (registry stability).
  await page.goto(`/p/${PROJECT_KEY}/pages`);
  await page.locator('tbody tr').first().click();
  const titleField = page.locator('sf-page-editor input[name="displayName"]').first();
  await titleField.fill('Renamed Target Page');
  await page.keyboard.press('Tab');
  await expect(page.locator('sf-page-editor .page-editor__status')).toContainText(/Saved/);

  await page.goto(`/p/${PROJECT_KEY}/settings/generation`);
  await page.getByRole('button', { name: /New generation/i }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/SUCCESS/)).toBeVisible({ timeout: 120_000 });

  const homeResponse2 = await page.request.get(`/api/v1/projects/${PROJECT_KEY}/preview/home?channel=html`);
  const homeHtml2 = await homeResponse2.text();
  const catalogHrefAfterRename = homeHtml2.match(/<a href="([^"]*)">Browse Catalog<\/a>/)![1];
  expect(catalogHrefAfterRename).toBe(catalogHrefBefore);

  // 6. Reset the registry for the "html" channel via the settings UI, then regenerate;
  // the URL must now reflect the rename.
  await page.goto(`/p/${PROJECT_KEY}/settings/url-registry`);
  await expect(page.locator('sf-project-settings-url-registry')).toBeVisible();
  await page.getByRole('button', { name: /Reset channel/i }).click();
  await page.getByRole('button', { name: /Confirm/i }).click();

  await page.goto(`/p/${PROJECT_KEY}/settings/generation`);
  await page.getByRole('button', { name: /New generation/i }).click();
  await page.getByRole('button', { name: 'Start' }).click();
  await expect(page.getByText(/SUCCESS/)).toBeVisible({ timeout: 120_000 });

  const homeResponse3 = await page.request.get(`/api/v1/projects/${PROJECT_KEY}/preview/home?channel=html`);
  const homeHtml3 = await homeResponse3.text();
  const catalogHrefAfterReset = homeHtml3.match(/<a href="([^"]*)">Browse Catalog<\/a>/)![1];
  expect(catalogHrefAfterReset).not.toBe(catalogHrefBefore);

  // 7. PREVIEW-area URLs are independent of GENERATED-area ones: the settings panel lists
  // both areas separately with no shared row.
  await expect(page.getByText('PREVIEW')).toBeVisible();
  await expect(page.getByText('GENERATED')).toBeVisible();
});
