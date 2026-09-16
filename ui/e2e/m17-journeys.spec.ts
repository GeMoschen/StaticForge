import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';

/**
 * M17 Globals store journeys (feature `docs-e2e`, `M17.5.2`):
 *   1. a developer creates property set `site` in the Globals screen, writes CDL with an error
 *      (SF-CDL-0107 shown inline), fixes it, saves, and fills in the values;
 *   2. the value is read by a page template through `$CMS_VALUE(CMS_GLOBAL.site.title)$` and shows in
 *      the page preview, and follows an edit made on the Globals screen;
 *   3. as an editor, the Schema tab is read-only while the Values tab stays editable;
 *   4. during time travel the whole Globals screen is read-only and shows the historical value.
 *
 * Self-seeding like `m16-journeys.spec.ts`: each journey creates its own project through the REST
 * API, so it only needs a running dev backend with an instance admin — no demo seed.
 *
 * Prerequisites:
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev ./gradlew :server:sf-app:bootRun` (port 8081, seeded
 *     instance admin `Admin` / `Admin`).
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m17-journeys.spec.ts`.
 *
 * The access token is memory-only: `page.goto` to a deep link drops the session, so after the
 * login every navigation goes through the router (`history.pushState` + `popstate`).
 *
 * Journey 3 and the role split: there is no REST endpoint to create a second user, so the journey
 * demotes the seeded admin's own membership to `EDITOR` on its throwaway project and logs in again,
 * which is what the UI reads its role from. The instance admin still passes every server-side role
 * check, so this journey proves the *UI* gating only; the server's `403` for an editor saving a
 * schema is proven by `GlobalsApiTest` in `server/sf-app`.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

test.use({ baseURL: BASE_URL });

type Json = Record<string, any>;

const SITE_CDL = 'content {\n  editor text title { label "Site title" required }\n  editor boolean showBanner { label "Show banner" }\n}\n';

class Api {
  private constructor(
    private readonly ctx: APIRequestContext,
    readonly projectKey: string,
  ) {}

  static async forNewProject(prefix: string): Promise<Api> {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const login = await anon.post('/api/v1/auth/login', { data: { username: USER, password: PASSWORD } });
    expect(login.ok(), `login: ${await login.text()}`).toBeTruthy();
    const token = (await login.json()).accessToken as string;
    await anon.dispose();
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    const key = `${prefix}${Date.now()}`;
    const api = new Api(ctx, key);
    await api.post('/api/v1/projects', { key, name: `M17 ${prefix}` });
    return api;
  }

  private url(p: string): string {
    return p.startsWith('/api') ? p : `/api/v1/projects/${this.projectKey}${p}`;
  }

  async post(p: string, data: unknown): Promise<Json> {
    const res = await this.ctx.post(this.url(p), { data });
    expect(res.ok(), `POST ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async put(p: string, data: unknown, headers?: Record<string, string>): Promise<Json> {
    const res = await this.ctx.put(this.url(p), { data, headers });
    expect(res.ok(), `PUT ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async get(p: string): Promise<any> {
    const res = await this.ctx.get(this.url(p));
    expect(res.ok(), `GET ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  pageTemplate(displayName: string, source: string): Promise<Json> {
    return this.post('/page-templates', { displayName, contentDefinition: '', channelSources: { html: source } });
  }

  page(displayName: string, templateUuid: string): Promise<Json> {
    return this.post('/pages', { displayName, templateUuid });
  }

  globalSet(displayName: string, contentDefinition: string): Promise<Json> {
    return this.post('/globals', { displayName, contentDefinition });
  }

  async setValues(uuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/globals/${uuid}`);
    return this.put(`/globals/${uuid}/content`, { content }, { 'If-Match': `"rev-${current.revision}"` });
  }

  async revisions(): Promise<Json[]> {
    return this.get('/revisions');
  }

  async demoteSelfTo(role: string): Promise<void> {
    const me = await this.get('/api/v1/auth/me');
    await this.put(`/api/v1/projects/${this.projectKey}/members/${me.id}`, { role });
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('sf-login input[formControlName="username"]').fill(USER);
  await page.locator('sf-login input[formControlName="password"]').fill(PASSWORD);
  await page.locator('sf-login button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

/** In-app navigation that keeps the memory-only token (a `page.goto` would log out). */
async function navigate(page: Page, url: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

function previewBody(page: Page) {
  return page.frameLocator('sf-page-editor sf-preview-frame iframe.preview-frame').locator('body');
}

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

function globalsTree(page: Page) {
  return page.locator('sf-globals .globals__tree');
}

function detail(page: Page) {
  return page.locator('sf-global-set-detail');
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey 1: a developer creates a property set, fixes a CDL error and fills in its values', async ({ page }) => {
  const api = await Api.forNewProject('m17a');
  try {
    await login(page);
    await navigate(page, `/p/${api.projectKey}/globals`);
    await expect(page.locator('sf-globals')).toBeVisible();
    await expect(page.locator('sf-nav-rail').getByText('Globals')).toBeVisible();

    // Create "Site" through the create dialog; it opens with a starter CDL.
    await page.getByRole('button', { name: 'New property set' }).click();
    await page.locator('sf-create-asset-dialog input').first().fill('Site');
    await page.locator('sf-create-asset-dialog').getByRole('button', { name: /create/i }).click();
    await expect(globalsTree(page).getByText('Site')).toBeVisible();
    await expect(detail(page).locator('.global-detail__uid')).toHaveText('site');

    // Schema: a body is not allowed in a property set — the diagnostic appears inline and nothing saves.
    await detail(page).getByRole('tab', { name: 'Schema' }).click();
    const cdl = detail(page).locator('textarea');
    await cdl.fill(`${SITE_CDL}bodies { body main { label "Main" allow ["*"] } }\n`);
    await detail(page).getByRole('button', { name: 'Save schema' }).click();
    await expect(detail(page).locator('.diagnostics')).toContainText('SF-CDL-0107');
    await snap(page, 'j1-cdl-diagnostic');

    // Fix it and save.
    await cdl.fill(SITE_CDL);
    await detail(page).getByRole('button', { name: 'Save schema' }).click();
    await expect(detail(page).locator('.diagnostics')).toHaveCount(0);

    // Values: the rebuilt form shows the new fields.
    await detail(page).getByRole('tab', { name: 'Values' }).click();
    await detail(page).locator('sf-content-form input').first().fill('Acme Outdoor');
    await detail(page).getByRole('button', { name: 'Save values' }).click();
    await expect(page.getByText('Values saved')).toBeVisible();
    await snap(page, 'j1-values-saved');

    const sets = await api.get('/globals');
    expect(sets).toHaveLength(1);
    const saved = await api.get(`/globals/${sets[0].uuid}`);
    expect(saved.content.title).toBe('Acme Outdoor');
  } finally {
    await api.dispose();
  }
});

test('journey 2: a page preview shows the property-set value and follows an edit', async ({ page }) => {
  const api = await Api.forNewProject('m17b');
  try {
    const site = await api.globalSet('Site', SITE_CDL);
    await api.setValues(site.uuid, { title: 'Acme Outdoor', showBanner: true });
    const tpl = await api.pageTemplate(
      'Header',
      '<h1 id="t">$CMS_VALUE(CMS_GLOBAL.site.title)$</h1>$CMS_IF(CMS_GLOBAL.site.showBanner)$<p>banner</p>$CMS_END_IF$',
    );
    const home = await api.page('home', tpl.uuid);

    // Usages list the template right after it was saved, before any generation.
    const usages = await api.get(`/assets/${site.uuid}/usages`);
    expect(JSON.stringify(usages)).toContain(tpl.uuid);

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages/${home.uuid}`);
    await expect(previewBody(page)).toContainText('Acme Outdoor', { timeout: 15_000 });
    await expect(previewBody(page)).toContainText('banner');

    // Edit the value on the Globals screen, then refresh the page preview.
    await navigate(page, `/p/${api.projectKey}/globals`);
    await globalsTree(page).getByText('Site').click();
    await detail(page).locator('sf-content-form input').first().fill('Acme Outdoor Co.');
    await detail(page).getByRole('button', { name: 'Save values' }).click();
    await expect(page.getByText('Values saved')).toBeVisible();

    await navigate(page, `/p/${api.projectKey}/pages/${home.uuid}`);
    await page.locator('sf-page-editor sf-preview-frame').getByRole('button', { name: 'Refresh' }).click();
    await expect(previewBody(page)).toContainText('Acme Outdoor Co.', { timeout: 15_000 });
    await snap(page, 'j2-preview-follows-edit');
  } finally {
    await api.dispose();
  }
});

test('journey 3: for an editor the Schema tab is read-only and the Values tab is editable', async ({ page }) => {
  const api = await Api.forNewProject('m17c');
  try {
    const site = await api.globalSet('Site', SITE_CDL);
    await api.demoteSelfTo('EDITOR');

    await login(page);
    await navigate(page, `/p/${api.projectKey}/globals`);
    await globalsTree(page).getByText('Site').click();

    await expect(detail(page).getByRole('button', { name: 'Save values' })).toBeEnabled();
    await detail(page).getByRole('tab', { name: 'Schema' }).click();
    await expect(detail(page).locator('textarea')).toBeDisabled();
    await expect(detail(page).getByRole('button', { name: 'Save schema' })).toBeDisabled();
    await expect(detail(page).getByText('You need the developer role to change this schema.')).toBeVisible();
    await snap(page, 'j3-editor-schema-read-only');
    expect(site.uuid).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('journey 4: time travel makes the Globals screen read-only and shows the old value', async ({ page }) => {
  const api = await Api.forNewProject('m17d');
  try {
    const site = await api.globalSet('Site', SITE_CDL);
    await api.setValues(site.uuid, { title: 'Old title' });
    const before = (await api.revisions())[0].revisionId as number;
    await api.setValues(site.uuid, { title: 'New title' });

    await login(page);
    await navigate(page, `/p/${api.projectKey}/globals`);
    await globalsTree(page).getByText('Site').click();
    await expect(detail(page).locator('sf-content-form input').first()).toHaveValue('New title');

    // Enter time travel the way a user does: a tick on the revision spine. It opens that revision's
    // diff; the time-travel state lives in a root store, so in-app navigation back keeps it.
    await page
      .locator('sf-revision-spine')
      .getByRole('button', { name: new RegExp(`^Revision ${before} ·`) })
      .click();
    await expect(page.locator('.shell__timemachine')).toContainText(`Viewing revision ${before}`);
    await navigate(page, `/p/${api.projectKey}/globals`);
    await globalsTree(page).getByText('Site').click();

    await expect(detail(page).getByText(/read-only until you leave time travel/)).toBeVisible();
    await expect(detail(page).locator('sf-content-form input').first()).toHaveValue('Old title');
    await expect(detail(page).getByRole('button', { name: 'Save values' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'New property set' })).toBeDisabled();
    await snap(page, 'j4-time-travel-read-only');
  } finally {
    await api.dispose();
  }
});
