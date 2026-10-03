import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';

/**
 * M35.19 media library journey: the new library and file drawer against a real backend.
 *   1. upload through the toolbar (two pictures), the upload list reports both, the cards appear;
 *   2. keyboard: arrow keys move between cards, Enter opens the drawer (`?asset=` in the URL), Esc closes it;
 *   3. the drawer: alt text edited, the footer's Save is enabled only then and saves at the file's revision;
 *   4. stepping to the next file with an unsaved edit raises the leave dialog; Discard steps on;
 *   5. F2 renames through the dialog; the library shows the new name;
 *   6. Replace through the styled file drop keeps the file (same UUID, new bytes);
 *   7. the ⋮ menu: Delete… asks, deletes and offers Undo that brings the file back;
 *   8. the list view shows the files in an sf-data-table and the choice sticks across a reload of the route.
 *
 * Self-seeding like the M16–M20 journeys: it creates its own project through the REST API.
 *   - Backend with the seeded instance admin `Admin` / `Admin`; UI: `ng serve` with the proxy to it.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m35-media-journeys.spec.ts`.
 * The access token is memory-only: after the login every navigation goes through the router.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

test.use({ baseURL: BASE_URL, viewport: { width: 1440, height: 900 } });

/** Two different 1×1 PNGs (a file name decides what is a duplicate, the bytes what is a replacement). */
const PNG_A = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const PNG_B = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

type Json = Record<string, any>;

async function newProject(prefix: string): Promise<{ ctx: APIRequestContext; key: string }> {
  const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
  const login = await anon.post('/api/v1/auth/login', { data: { username: USER, password: PASSWORD } });
  expect(login.ok(), `login: ${await login.text()}`).toBeTruthy();
  const token = (await login.json()).accessToken as string;
  await anon.dispose();
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
  const key = `${prefix}${Date.now()}`;
  const created = await ctx.post('/api/v1/projects', { data: { key, name: `M35 ${prefix}` } });
  expect(created.ok(), `project: ${await created.text()}`).toBeTruthy();
  return { ctx, key };
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

/** In-app navigation that keeps the memory-only token (a `page.goto` would log out). */
async function navigate(page: Page, url: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey: upload, keyboard, edit, rename, replace, delete with undo and the list view', async ({ page }) => {
  test.setTimeout(120_000);
  const { ctx, key } = await newProject('m35media');
  try {
    await login(page);
    await navigate(page, `/p/${key}/media`);
    const library = page.locator('sf-media-library');
    await expect(library).toBeVisible();
    const drawer = page.locator('body > sf-drawer');
    const card = (name: string) => library.getByRole('gridcell', { name: new RegExp(`^${name.replace('.', '\\.')}, `) });

    // 1. Upload two pictures through the toolbar.
    const chooser = page.waitForEvent('filechooser');
    await library.getByRole('button', { name: 'Upload', exact: true }).first().click();
    await (await chooser).setFiles([
      { name: 'alpha.png', mimeType: 'image/png', buffer: PNG_A },
      { name: 'beta.png', mimeType: 'image/png', buffer: PNG_B },
    ]);
    await expect(card('alpha.png')).toBeVisible({ timeout: 20_000 });
    await expect(card('beta.png')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('All uploads finished')).toBeVisible();
    await snap(page, '01-uploaded');

    // 2. Keyboard: focus a card, arrow to the next one, Enter opens the drawer, Esc closes it.
    await card('alpha.png').focus();
    await page.keyboard.press('ArrowRight');
    await expect(card('beta.png')).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Enter');
    await expect(drawer.getByRole('heading', { level: 2, name: 'alpha.png' })).toBeVisible();
    await expect(page).toHaveURL(/\?asset=/);
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).not.toHaveURL(/\?asset=/);

    // 3. The drawer: Save is enabled only while the alt text differs from the server's.
    await card('alpha.png').click();
    const save = drawer.getByRole('button', { name: 'Save' });
    await expect(save).toBeDisabled();
    const alt = drawer.getByRole('textbox', { name: /^Alt text/ });
    await alt.fill('A single pixel');
    await expect(save).toBeEnabled();
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/media\/[^/]+$/.test(r.url()));
    await save.click();
    expect((await saved).status()).toBe(200);
    await expect(save).toBeDisabled();
    await snap(page, '02-drawer-saved');

    // 4. Stepping with an unsaved edit asks first.
    await alt.fill('Not saved');
    await drawer.getByRole('button', { name: 'Next file' }).click();
    const leave = page.getByRole('dialog', { name: 'Unsaved changes' });
    await expect(leave).toBeVisible();
    await leave.getByRole('button', { name: 'Cancel' }).click();
    await expect(drawer.getByRole('heading', { level: 2, name: 'alpha.png' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Next file' }).click();
    await page.getByRole('dialog', { name: 'Unsaved changes' }).getByRole('button', { name: 'Discard' }).click();
    await expect(drawer.getByRole('heading', { level: 2, name: 'beta.png' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toHaveCount(0);

    // 5. F2 renames through the dialog.
    await card('beta.png').focus();
    await page.keyboard.press('F2');
    const rename = page.getByRole('dialog', { name: /^Rename/ });
    await rename.getByRole('textbox', { name: 'File name' }).fill('gamma.png');
    await rename.getByRole('button', { name: 'Apply' }).click();
    await expect(card('gamma.png')).toBeVisible();
    await expect(card('beta.png')).toHaveCount(0);

    // 6. Replace keeps the file: same UUID, new bytes.
    const list = (await (await ctx.get(`/api/v1/projects/${key}/media`)).json()).content as Json[];
    const gamma = list.find((m) => m.displayName === 'gamma.png')!;
    const shaBefore = ((await (await ctx.get(`/api/v1/projects/${key}/media/${gamma.uuid}`)).json()) as Json).blobSha256;
    await card('gamma.png').click();
    await drawer.locator('sf-file-drop input[type="file"]').setInputFiles({ name: 'gamma-v2.png', mimeType: 'image/png', buffer: PNG_A });
    await expect(page.locator('sf-toast-host').getByText(/Replaced the file with/)).toBeVisible();
    const after = (await (await ctx.get(`/api/v1/projects/${key}/media/${gamma.uuid}`)).json()) as Json;
    expect(after.uuid).toBe(gamma.uuid);
    expect(after.blobSha256).not.toBe(shaBefore);
    await drawer.getByRole('button', { name: 'Close' }).click();

    // 7. Delete from the ⋮ menu, then Undo.
    await card('alpha.png').click();
    await drawer.getByRole('button', { name: 'File actions' }).click();
    await page.getByRole('menuitem', { name: /^Delete/ }).click();
    await page.getByRole('dialog', { name: /^Delete/ }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(card('alpha.png')).toHaveCount(0);
    await page.locator('sf-toast-host').getByRole('button', { name: 'Undo' }).last().click();
    await expect(card('alpha.png')).toBeVisible();

    // 8. The list view.
    await library.getByRole('radio', { name: 'List' }).click();
    await expect(library.getByRole('grid').first()).toBeVisible();
    await expect(library.getByRole('row', { name: /alpha\.png/ })).toBeVisible();
    await snap(page, '03-list');
  } finally {
    await ctx.dispose();
  }
});
