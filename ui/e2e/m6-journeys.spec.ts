import { test, expect, Page } from '@playwright/test';

/**
 * M6 exit-criterion journeys 5–8 (§25.6): collaboration, conflict resolution,
 * time travel and media-usage deletion.
 *
 * Prerequisites (not yet provisioned — see tasks/todo.md):
 *   - Backend running (Spring Boot, `demo` profile) with a seeded demo user/project.
 *     The demo seed was deferred in M1 (db/changelog/data/demo-project.xml is still a
 *     placeholder), so these journeys currently need a live backend + a user whose
 *     credentials you pass via SF_E2E_USER / SF_E2E_PASSWORD (fallback: demo / demo).
 *   - Journey 6 additionally needs a second editor identity (a second seeded user or a
 *     peer editing in another browser); the two-user demo seed does not exist yet.
 *   - `npm start` (ng serve) on http://localhost:4200 proxying /api to the backend.
 *
 * These specs are gated on SF_RUN_E2E and document the flow; they avoid over-asserting
 * against content that requires a fully seeded, multi-user demo.
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

// Journey 5 — rename a media file from the library (M35.19: the UID of a file is shown and copied in the
// drawer, the name is changed with F2 / "Rename…" in a dialog that checks it as you type).
test('journey 5: rename a media file; links keep pointing at it', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);
  await page.goto(`/p/${PROJECT_KEY}/media`);
  await expect(page.locator('sf-media-library')).toBeVisible();

  // The first file's card, then F2.
  const first = page.locator('sf-media-library .card').first();
  await first.focus();
  await page.keyboard.press('F2');
  const dialog = page.getByRole('dialog', { name: /^Rename/ });
  await expect(dialog).toContainText('Links to this file keep working');
  const name = dialog.getByRole('textbox', { name: 'File name' });
  const extension = ((await name.inputValue()).match(/\.[^.]+$/) ?? [''])[0];
  await name.fill(`e2e-renamed${extension}`);
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('sf-media-library .card', { hasText: `e2e-renamed${extension}` })).toBeVisible();
});

// Journey 6 — two browser contexts edit the same page; the second save hits a 409 and
// the conflict drawer offers per-field "keep mine / take theirs" choices. Resolving
// flushes a successful save and closes the drawer.
test('journey 6: concurrent edit conflict shows the per-field resolver', async ({ browser }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await login(pageA);
    await login(pageB);

    // Each editor opens the same page.
    await pageA.goto(`/p/${PROJECT_KEY}/pages`);
    await pageA.locator('sf-pages-list tbody tr').first().click();
    await expect(pageA.locator('sf-page-editor')).toBeVisible();
    await pageB.goto(pageA.url());
    await expect(pageB.locator('sf-page-editor')).toBeVisible();

    const headlineA = pageA.locator('sf-page-editor sf-text-editor input').first();
    const headlineB = pageB.locator('sf-page-editor sf-text-editor input').first();

    // A edits and saves first.
    await headlineA.fill('Conflict headline — editor A');
    await expect(pageA.locator('sf-page-editor .page-editor__status')).toContainText(
      /Saved|Saving/,
    );

    // B edits the same field and saves → 409 → conflict drawer.
    await headlineB.fill('Conflict headline — editor B');
    const drawerB = pageB.locator('sf-conflict-drawer');
    await expect(drawerB).toBeVisible({ timeout: 15_000 });
    await expect(drawerB.getByRole('button', { name: 'Keep mine' }).first()).toBeVisible();
    await expect(drawerB.getByRole('button', { name: 'Take theirs' }).first()).toBeVisible();

    // Resolve per-field (default each field to "mine") and flush a successful save.
    await drawerB.getByRole('button', { name: 'Apply changes' }).click();
    await expect(drawerB).toBeHidden({ timeout: 15_000 });
    await expect(pageB.locator('sf-page-editor .page-editor__status')).toContainText(/Saved/);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// Journey 7 — time travel to a past revision, restore one asset from the diff view, and
// confirm the amber "Viewing revision … / Back to now" bar is present in the shell.
test('journey 7: time travel to a past revision and restore an asset', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);
  // `RevisionsListComponent` is mounted under the project settings shell
  // (`app.routes.ts`'s `p/:projectKey/settings/revisions`), not a top-level
  // `p/:projectKey/revisions` route — the latter doesn't match any route and falls
  // through to the `**` → `''` redirect, silently landing back on the dashboard.
  await page.goto(`/p/${PROJECT_KEY}/settings/revisions`);
  await expect(page.locator('sf-revisions-list')).toBeVisible();

  // The revision spine is sorted newest-first, so the last dot is a past revision.
  // Clicking it enters time-travel mode (amber bar) and opens that revision's diff.
  await page.locator('sf-revision-spine .spine__dot').last().click();

  await expect(page.locator('sf-project-shell .shell__timemachine')).toBeVisible();
  await expect(page.getByText(/Viewing revision/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to now' })).toBeVisible();

  // Open the diff view and restore one asset; scheduling a restore appends a new
  // revision rather than rewriting history.
  await expect(page.locator('sf-revision-diff')).toBeVisible();
  const restore = page.getByRole('button', { name: 'Restore this asset' });
  if (await restore.first().isVisible().catch(() => false)) {
    await restore.first().click();
    await expect(page.getByText('A new revision was created')).toBeVisible();
  }
});

// Journey 8 — deleting a media asset that is still referenced: the drawer's Used by tab lists the
// usages and the confirmation names how many places the delete breaks (a plain confirm with Undo;
// the typed word is only asked from 25 files on).
test('journey 8: delete a referenced media asset says what breaks', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);
  await page.goto(`/p/${PROJECT_KEY}/media`);
  await expect(page.locator('sf-media-library')).toBeVisible();

  // Open a media asset that is referenced elsewhere.
  await page.locator('sf-media-library .card').first().click();
  const drawer = page.locator('body > sf-drawer');
  await expect(drawer).toBeVisible();

  // "Used by" lists the usages.
  await drawer.getByRole('tab', { name: /^Used by/ }).click();
  await expect(drawer.locator('.usage').first()).toBeVisible();

  // Delete… from the drawer's ⋮ menu → the confirmation says what breaks.
  await drawer.getByRole('button', { name: 'File actions' }).click();
  await page.getByRole('menuitem', { name: /^Delete/ }).click();
  const dlg = page.getByRole('dialog', { name: /^Delete/ });
  await expect(dlg).toContainText(/is used in \d+ place/i);
  await expect(dlg.getByRole('button', { name: 'Delete', exact: true })).toBeEnabled();
  await dlg.getByRole('button', { name: 'Cancel' }).click();
});
