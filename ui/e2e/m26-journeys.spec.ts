import { test, expect, request as playwrightRequest, Browser, BrowserContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * M26 user management journey (feature `docs-e2e`, `M26.5.2`) — the whole epic in the running app, with one browser
 * context per person:
 *   1. the admin opens Administration from the user menu and creates `editor-e2e-*` with a generated password and an
 *      EDITOR membership of a fresh project, copying the one-time password;
 *   2. the editor signs in with it, has to set a new password (rules visible, a too-short one can't be submitted) and
 *      lands on the dashboard with exactly that project;
 *   3. the admin creates `pa-e2e-*` (project admin of the project) and `viewer-e2e-*` (no memberships); the project
 *      admin adds the viewer as VIEWER through the Members tab lookup and makes them EDITOR; the editor sees the
 *      Members tab read-only and without emails;
 *   4. the admin disables the editor while they have the project open: their next action ends on the sign-in page and
 *      signing in is refused; enabling restores access;
 *   5. the admin archives the project: the editor no longer sees it; the admin sees the banner and no enabled create
 *      control on the pages view, and unarchives from the banner; the editor sees it again;
 *   6. the editor changes their display name and signs out everywhere; the admin deletes a throwaway user (type the
 *      username) and the Audit tab, filtered by action, shows USER_CREATED, USER_DISABLED, PROJECT_ARCHIVED and
 *      USER_DELETED for this run.
 *
 * Prerequisites (as for the M16–M25 journeys):
 *   - Backend on a clean database: `SPRING_PROFILES_ACTIVE=dev SF_DB_FILE=<scratch dir>/db ./gradlew
 *     :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m26-journeys.spec.ts`.
 *
 * Self-seeding: every name carries a per-run suffix, so the journey runs again on the same database. The access token
 * is memory-only, so after each sign-in every navigation goes through the app's own links.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const ADMIN_USER = process.env['SF_E2E_USER'] ?? 'Admin';
const ADMIN_PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'Admin';
const SHOTS_DIR = process.env['SF_E2E_SHOTS_DIR'];

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });

const RUN = Date.now().toString(36);
const PROJECT_KEY = `m26e2e${RUN}`;
const PROJECT_NAME = `M26 journey ${RUN}`;
const EDITOR = `editor-e2e-${RUN}`;
const PA = `pa-e2e-${RUN}`;
const VIEWER = `viewer-e2e-${RUN}`;
const THROWAWAY = `throwaway-e2e-${RUN}`;
const EDITOR_NAME = `Eddie ${RUN}`;
const PA_NAME = `Pat ${RUN}`;
const VIEWER_NAME = `Vic ${RUN}`;
const THROWAWAY_NAME = `Tom ${RUN}`;
const EDITOR_PASSWORD = 'editor-journey-pw-1';
const PA_PASSWORD = 'project-admin-pw-1';

async function snap(page: Page, name: string): Promise<void> {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (SHOTS_DIR) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.copyFileSync(file, path.join(SHOTS_DIR, `m26-${name}.png`));
  }
}

/** A person with their own browser context; `window.confirm` dialogs are accepted like a user would. */
async function person(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  page.on('dialog', (dialog) => void dialog.accept());
  return { context, page };
}

/** Sign-in hashes the password (BCrypt) and loads the profile: allow it the M25 journeys' 15 s. */
const SIGN_IN_TIMEOUT = { timeout: 15_000 };

async function signIn(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** A link of the project's nav rail. */
async function rail(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('link', { name, exact: true }).click();
}

async function openMenuItem(page: Page, item: RegExp): Promise<void> {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: item }).click();
}

/** Administration → a tab, from wherever the admin is. */
async function adminTab(page: Page, tab: 'Users' | 'Projects' | 'Audit'): Promise<void> {
  if (!/\/admin\//.test(page.url())) {
    await openMenuItem(page, /Administration/);
  }
  await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: tab }).click();
}

/** The dashboard, reached the way a user does from anywhere: My account → Projects. */
async function dashboard(page: Page): Promise<void> {
  await openMenuItem(page, /My account/);
  await page.getByRole('link', { name: 'Projects' }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function createUser(
  page: Page,
  options: { username: string; displayName: string; role?: string; password?: string; mustChange?: boolean },
): Promise<string | null> {
  await adminTab(page, 'Users');
  await page.getByRole('button', { name: 'New user' }).click();
  const dialog = page.getByRole('dialog', { name: 'New user' });
  await dialog.getByLabel('Username').fill(options.username);
  await dialog.getByLabel('Email').fill(`${options.username}@example.com`);
  await dialog.getByLabel('Display name').fill(options.displayName);
  if (options.password) {
    await dialog.getByLabel('Set a password').check();
    await dialog.getByLabel('New password').fill(options.password);
  }
  if (options.mustChange === false) {
    await dialog.getByLabel('Must change password at the next sign-in').uncheck();
  }
  if (options.role) {
    await dialog.getByRole('button', { name: 'Add project' }).click();
    await dialog.getByLabel('Project 1', { exact: true }).selectOption(PROJECT_KEY);
    await dialog.getByLabel('Role in project 1').selectOption(options.role);
  }
  await dialog.getByRole('button', { name: 'Create user' }).click();

  let generated: string | null = null;
  if (!options.password) {
    const shown = page.getByLabel('Generated password');
    await expect(shown).toBeVisible();
    generated = (await shown.textContent())!.trim();
    await page.getByRole('button', { name: 'Done' }).click();
  }
  await expect(page.getByRole('heading', { name: options.displayName })).toBeVisible();
  return generated;
}

test.describe('M26 user management journey', () => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');

  test('accounts, members, disable, archive, delete and audit', async ({ browser }) => {
    test.setTimeout(240_000);

    // Seed: a fresh project (the admin could create it on the dashboard; the journey is about accounts).
    const api = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const token = (await (await api.post('/api/v1/auth/login', {
      data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
    })).json()).accessToken as string;
    const created = await api.post('/api/v1/projects', {
      data: { key: PROJECT_KEY, name: PROJECT_NAME },
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    await api.dispose();

    const admin = await person(browser);
    const editor = await person(browser);
    const projectAdmin = await person(browser);
    const a = admin.page;
    const e = editor.page;
    const p = projectAdmin.page;

    // ── 1. the admin creates the editor with a generated password and a membership ──
    await signIn(a, ADMIN_USER, ADMIN_PASSWORD);
    await expect(a).toHaveURL(/\/$/, SIGN_IN_TIMEOUT);
    await openMenuItem(a, /Administration/);
    await expect(a.getByRole('heading', { name: 'Administration' })).toBeVisible();
    const temporary = await createUser(a, { username: EDITOR, displayName: EDITOR_NAME, role: 'EDITOR' });
    expect(temporary).toMatch(/^.{16}$/);
    await expect(a.getByText('Password change pending')).toBeVisible();
    await snap(a, '01-editor-created');

    // ── 2. the editor must set a new password first ──
    await signIn(e, EDITOR, temporary!);
    await expect(e).toHaveURL(/\/account\/set-password/, SIGN_IN_TIMEOUT);
    await e.getByLabel('Current password').fill(temporary!);
    await e.getByLabel('New password', { exact: true }).fill('short');
    await e.getByLabel('Confirm new password').fill('short');
    const rules = e.getByRole('list', { name: 'Password rules' });
    await expect(rules.getByText('At least 12 characters')).toBeVisible();
    await expect(rules.getByText('(not met)').first()).toBeAttached();
    await expect(e.getByRole('button', { name: 'Set password and continue' })).toBeDisabled();
    await snap(e, '02-set-password-too-short');
    await e.getByLabel('New password', { exact: true }).fill(EDITOR_PASSWORD);
    await e.getByLabel('Confirm new password').fill(EDITOR_PASSWORD);
    await e.getByRole('button', { name: 'Set password and continue' }).click();
    await expect(e).toHaveURL(/\/$/);
    await expect(e.locator('a.card')).toHaveCount(1);
    await expect(e.locator('a.card')).toContainText(PROJECT_NAME);

    // ── 3. a project admin manages members through the Members tab ──
    await createUser(a, {
      username: PA,
      displayName: PA_NAME,
      role: 'PROJECT_ADMIN',
      password: PA_PASSWORD,
      mustChange: false,
    });
    await createUser(a, { username: VIEWER, displayName: VIEWER_NAME });

    await signIn(p, PA, PA_PASSWORD);
    await expect(p).toHaveURL(/\/$/, SIGN_IN_TIMEOUT);
    await p.locator('a.card', { hasText: PROJECT_NAME }).click();
    await rail(p, 'Settings');
    await p.getByRole('tab', { name: 'Members' }).click();
    await p.getByPlaceholder(/Search by name or username/).fill(VIEWER);
    await p.getByRole('option', { name: new RegExp(VIEWER_NAME) }).click();
    await p.getByLabel('Role', { exact: true }).selectOption('VIEWER');
    await p.getByRole('button', { name: 'Add', exact: true }).click();
    const viewerRole = p.getByRole('combobox', { name: `Role of ${VIEWER_NAME}` });
    await expect(viewerRole).toHaveValue('VIEWER');
    await viewerRole.selectOption('EDITOR');
    await expect(p.getByRole('combobox', { name: `Role of ${VIEWER_NAME}` })).toHaveValue('EDITOR');
    await expect(p.getByRole('columnheader', { name: 'Email' })).toBeVisible();
    await snap(p, '03-members-project-admin');

    await e.locator('a.card', { hasText: PROJECT_NAME }).click();
    await rail(e, 'Settings');
    await e.getByRole('tab', { name: 'Members' }).click();
    await expect(e.getByText(VIEWER_NAME)).toBeVisible();
    await expect(e.getByRole('group', { name: 'Add member' })).toHaveCount(0);
    await expect(e.getByRole('combobox', { name: /Role of/ })).toHaveCount(0);
    await expect(e.getByRole('columnheader', { name: 'Email' })).toHaveCount(0);
    await snap(e, '04-members-editor-read-only');

    // ── 4. disabled while the project is open ──
    await rail(e, 'Pages');
    await expect(e.getByRole('button', { name: 'New page' })).toBeEnabled();
    await adminTab(a, 'Users');
    await a.getByRole('link', { name: EDITOR_NAME }).click();
    await a.getByRole('button', { name: 'Disable' }).click();
    await expect(a.getByRole('button', { name: 'Enable' })).toBeVisible();

    await rail(e, 'Content');
    await expect(e).toHaveURL(/\/login/);
    await signIn(e, EDITOR, EDITOR_PASSWORD);
    await expect(e.getByRole('alert')).toHaveText('Invalid username or password.');
    await expect(e).toHaveURL(/\/login/);

    await a.getByRole('button', { name: 'Enable' }).click();
    await expect(a.getByRole('button', { name: 'Disable' })).toBeVisible();
    await signIn(e, EDITOR, EDITOR_PASSWORD);
    await expect(e).toHaveURL(/\/$/, SIGN_IN_TIMEOUT);
    await expect(e.locator('a.card', { hasText: PROJECT_NAME })).toBeVisible();

    // ── 5. archive and unarchive ──
    await adminTab(a, 'Projects');
    const projectRow = a.getByRole('row').filter({ hasText: PROJECT_KEY });
    await projectRow.getByRole('button', { name: /Archive/ }).click();
    await expect(projectRow.getByText('Archived')).toBeVisible();

    await dashboard(e);
    await expect(e.locator('a.card', { hasText: PROJECT_NAME })).toHaveCount(0);
    await snap(e, '05-editor-dashboard-archived');

    await projectRow.getByRole('link', { name: /Open/ }).click();
    await expect(a.getByText('This project is archived and read-only.')).toBeVisible();
    await expect(a.getByRole('button', { name: 'New page' })).toBeDisabled();
    await expect(a.getByTitle('New folder')).toBeDisabled();
    await snap(a, '06-archived-pages');
    await a.getByRole('button', { name: 'Unarchive' }).click();
    await expect(a.getByText('This project is archived and read-only.')).toHaveCount(0);
    await expect(a.getByRole('button', { name: 'New page' })).toBeEnabled();

    await dashboard(e);
    await expect(e.locator('a.card', { hasText: PROJECT_NAME })).toBeVisible();

    // ── 6. My account, sign out everywhere, delete, audit ──
    await openMenuItem(e, /My account/);
    const profile = e.getByRole('region', { name: 'Profile' });
    await profile.getByLabel('Display name').fill(`Eddie E. ${RUN}`);
    await profile.getByRole('button', { name: 'Save profile' }).click();
    await expect(e.getByRole('button', { name: `Account menu for Eddie E. ${RUN}` })).toBeVisible();
    await e.getByRole('button', { name: 'Sign out everywhere' }).click();
    await expect(e).toHaveURL(/\/login/);

    await createUser(a, { username: THROWAWAY, displayName: THROWAWAY_NAME });
    await a.getByRole('button', { name: 'Delete user' }).click();
    const confirm = a.getByRole('dialog', { name: `Delete ${THROWAWAY}?` });
    await confirm.getByLabel(`Type ${THROWAWAY} to confirm`).fill(THROWAWAY);
    await confirm.getByRole('button', { name: 'Delete user' }).click();
    await expect(a).toHaveURL(/\/admin\/users$/);

    await adminTab(a, 'Audit');
    await a.getByLabel('Actions').selectOption(['USER_CREATED', 'USER_DISABLED', 'PROJECT_ARCHIVED', 'USER_DELETED']);
    await expect(a).toHaveURL(/action=USER_CREATED/);
    const rows = a.locator('tbody tr');
    await expect(rows.filter({ hasText: 'USER_CREATED' }).filter({ hasText: `user:${EDITOR}` })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'USER_DISABLED' }).filter({ hasText: `user:${EDITOR}` })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'PROJECT_ARCHIVED' }).filter({ hasText: `project:${PROJECT_KEY}` })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'USER_DELETED' }).filter({ hasText: 'user:deleted-user-' }).first()).toBeVisible();
    // Only the chosen actions are listed.
    for (const action of await rows.locator('td:nth-child(2)').allTextContents()) {
      expect(['USER_CREATED', 'USER_DISABLED', 'PROJECT_ARCHIVED', 'USER_DELETED']).toContain(action.trim());
    }
    await snap(a, '07-audit');

    await admin.context.close();
    await editor.context.close();
    await projectAdmin.context.close();
  });
});
