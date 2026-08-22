import { test, expect, Page } from '@playwright/test';

/**
 * M7 accessibility checks (§24.7) across the key routes.
 *
 * axe-core strategy: `@axe-core/playwright` (and `axe-core`) are NOT installed
 * in this workspace (offline — no network to add them). A full per-screen axe
 * scan therefore cannot run yet. The scan is stubbed below (see
 * `axe scan (stubbed)` test) with the exact injection approach documented for
 * when a vendored axe runtime becomes available. In the meantime this spec
 * enforces the *structural* invariants that axe's "landmark / heading /
 * aria-current" rules target, so it still runs and fails loudly if a route
 * regresses its landmark, single-h1, or active-nav semantics.
 *
 * Gated on SF_RUN_E2E (same as m3/m5/m6 journeys): these assertions need a
 * running app + seeded demo backend at http://localhost:4200.
 */

const PROJECT_KEY = 'demo';

const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('sf-login input[name="username"]').fill(USER);
  await page.locator('sf-login input[name="password"]').fill(PASSWORD);
  await page.locator('sf-login button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
}

interface RouteCheck {
  name: string;
  path: string;
  hasNavRail: boolean;
}

const ROUTES: RouteCheck[] = [
  { name: 'dashboard', path: '/', hasNavRail: false },
  { name: 'pages', path: `/p/${PROJECT_KEY}/pages`, hasNavRail: true },
  { name: 'media', path: `/p/${PROJECT_KEY}/media`, hasNavRail: true },
  { name: 'generation', path: `/p/${PROJECT_KEY}/generation`, hasNavRail: true },
  { name: 'structures', path: `/p/${PROJECT_KEY}/structures`, hasNavRail: true },
  { name: 'channels', path: `/p/${PROJECT_KEY}/channels`, hasNavRail: true },
  { name: 'revisions', path: `/p/${PROJECT_KEY}/revisions`, hasNavRail: true },
];

for (const route of ROUTES) {
  test(`${route.name}: one h1, a main landmark, and correct aria-current`, async ({ page }) => {
    test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
    await login(page);
    await page.goto(route.path);
    await expect(page.locator('main').first()).toBeVisible();

    // Exactly one h1 per view (§24.7 "one h1 per view").
    const h1 = page.locator('h1');
    await expect(h1).toHaveCount(1);

    if (route.hasNavRail) {
      const rail = page.locator('nav[aria-label="Project navigation"]');
      await expect(rail).toBeVisible();
      // Exactly one active nav item, marked aria-current="page".
      await expect(rail.locator('a[aria-current="page"]')).toHaveCount(1);
    }
  });
}

test('axe scan (stubbed) — enable once axe-core is vendored', async ({ page }) => {
  // Intentionally skipped: `@axe-core/playwright` is not installed and cannot
  // be added offline. To enable, drop a vendored `axe.min.js` at
  // `e2e/vendor/axe.min.js` and run:
  //
  //   await page.goto(path);
  //   await page.addScriptTag({ path: 'e2e/vendor/axe.min.js' });
  //   const results = await page.evaluate(async () => (window as any).axe.run());
  //   // assert results.violations has no impact 'serious' | 'critical'
  test.skip(true, 'requires vendored axe runtime + SF_RUN_E2E');
});
