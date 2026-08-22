import { test, expect, Page } from '@playwright/test';

/**
 * M5 exit-criterion journey 4 (§25.6): create a markdown channel, then generate both
 * channels and verify two output files are written.
 *
 * Prerequisites (not yet provisioned — see tasks/todo.md):
 *   - Backend running (Spring Boot, `demo` profile) with a seeded demo user/project.
 *   - `npm start` (ng serve) on http://localhost:4200 proxying /api to the backend.
 * The demo seed is deferred, so this spec is gated on SF_RUN_E2E and documents the flow.
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

// Journey 4 — create a `markdown` channel (copying templates from `html`), then run a
// FULL generation over html + markdown and assert files are written for both channels.
test('journey 4: create a markdown channel and generate both channels', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);

  // Create the markdown channel by copying templates from html.
  await page.goto(`/p/${PROJECT_KEY}/channels`);
  await page.getByRole('button', { name: /New channel/i }).click();
  await page.locator('sf-channel-form input[name="key"]').fill('markdown');
  await page.locator('sf-channel-form input[name="name"]').fill('Markdown');
  await page.locator('sf-channel-form select[name="copyFrom"]').selectOption('html');
  await page.getByRole('button', { name: /Save|Create/i }).click();
  await expect(page.getByText('markdown')).toBeVisible();

  // Start a FULL generation over both channels.
  await page.goto(`/p/${PROJECT_KEY}/generation`);
  await page.getByRole('button', { name: /Generate|Start run/i }).click();
  await expect(page.getByText(/SUCCESS/)).toBeVisible({ timeout: 120_000 });

  // The run-history row records filesWritten >= 2 (one per channel).
  const filesCell = page.locator('sf-generation-runs tbody tr').first().locator('td').nth(3);
  await expect(filesCell).toContainText(/[2-9]|\d{2,}/);
});
