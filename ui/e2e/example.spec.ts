import { test, expect } from '@playwright/test';

// The app boots, finds no in-memory access token, and the authGuard redirects
// `/` to `/login`, which renders the login card (spec §24.5 #1).
test('unauthenticated visit is redirected to the login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('sf-login')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
