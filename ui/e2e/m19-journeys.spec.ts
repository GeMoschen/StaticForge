import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import { cdl } from './cdl';

/**
 * M19 Content store journeys (feature `docs-e2e`, `M19.5.2`):
 *   1. a developer defines dataset `team` in the Templates store: a `body` is rejected inline
 *      (SF-CDL-0108), the fixed schema saves and shows its record count;
 *   2. an editor creates records in a record set of the Content store (M25: a record always lives in a set),
 *      edits one in the record editor (autosave), and filters the set's grid with a `where` expression — an
 *      invalid one shows the server's diagnostic;
 *   3. a `reference` editor restricted to the dataset picks a record, and the page preview renders the
 *      dereferenced record value;
 *   4. time travel to before a record edit makes the record editor read-only with the old value, and the
 *      page preview shows the old value too.
 *
 * Self-seeding like the M16–M18 journeys: each creates its own project through the REST API and only
 * needs a running dev backend with an instance admin.
 *
 * Prerequisites:
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true` (port 8081,
 *     instance admin `Admin` / `Admin`).
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m19-journeys.spec.ts`.
 *
 * The access token is memory-only: after the login every navigation goes through the router.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

test.use({ baseURL: BASE_URL });

type Json = Record<string, any>;

const TEAM_CDL =
  'content {\n  editor text name { label "Name" required }\n  editor text role { label "Role" }\n  editor number level { label "Level" }\n}\n';

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
    await api.post('/api/v1/projects', { key, name: `M19 ${prefix}` });
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

  dataset(displayName: string, contentDefinition: string, titleEditor?: string): Promise<Json> {
    return this.post('/datasets', { displayName, ...cdl(contentDefinition), titleEditor });
  }

  /** A record set of the dataset (M25): records can only be created inside one. */
  recordSet(datasetUuid: string, displayName: string): Promise<Json> {
    return this.post('/record-sets', { datasetUuid, displayName });
  }

  record(datasetUuid: string, recordSetUuid: string, content: Json): Promise<Json> {
    return this.post(`/datasets/${datasetUuid}/records`, { recordSetUuid, content });
  }

  async updateRecord(uuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/records/${uuid}`);
    return this.put(`/records/${uuid}`, { content }, { 'If-Match': `"rev-${current.revision}"` });
  }

  pageTemplate(displayName: string, contentDefinition: string, source: string): Promise<Json> {
    return this.post('/page-templates', { displayName, ...cdl(contentDefinition), channelSources: { html: source } });
  }

  page(displayName: string, templateUuid: string): Promise<Json> {
    return this.post('/pages', { displayName, templateUuid });
  }

  async revisions(): Promise<Json[]> {
    return this.get('/revisions');
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

function field(page: Page, label: string) {
  return page.locator('sf-record-editor sf-field').filter({ hasText: label }).locator('input');
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey 1: a developer defines a dataset in the Templates store', async ({ page }) => {
  const api = await Api.forNewProject('m19a');
  try {
    await login(page);
    await navigate(page, `/p/${api.projectKey}/templates?kind=DATASET`);
    await expect(page.locator('sf-nav-rail').getByRole('link', { name: 'Content' })).toBeVisible();

    await expect(page.locator('sf-templates').getByRole('treeitem', { name: /Datasets/ })).toBeVisible();
    await page.locator('sf-templates').getByRole('button', { name: 'New dataset' }).click();
    await page.locator('sf-create-asset-dialog input').first().fill('Team');
    await page.locator('sf-create-asset-dialog').getByRole('button', { name: /create/i }).click();

    const editor = page.locator('sf-dataset-schema-editor');
    await expect(editor.locator('h3')).toHaveText('Team');
    // The Content tab (M34): a pagination editor is a page's, not a record's — flagged live, nothing saved.
    const fields = editor.getByRole('textbox', { name: 'Record fields (CDL) — Content' });
    await fields.fill(`${cdl(TEAM_CDL).contentCdl}\neditor pagination posts { sources ["nav"] }\n`);
    await expect(editor.locator('sf-cdl-sections-editor')).toContainText('SF-CDL-0110', { timeout: 10_000 });
    await snap(page, 'j1-pagination-rejected');

    await fields.fill(cdl(TEAM_CDL).contentCdl);
    await expect(editor.locator('sf-cdl-sections-editor .diagnostic')).toHaveCount(0, { timeout: 10_000 });
    await editor.getByRole('button', { name: 'Save dataset' }).click();
    await expect(editor.getByRole('button', { name: 'Save dataset' })).toBeDisabled({ timeout: 10_000 });
    await expect(editor.getByText('0 records')).toBeVisible();

    const datasets = await api.get('/datasets');
    expect(datasets).toHaveLength(1);
    const saved = await api.get(`/datasets/${datasets[0].uuid}`);
    expect(saved.contentCdl).toContain('editor number level');
    expect(saved.folderPath).toBe('/templates_root/datasets/');
  } finally {
    await api.dispose();
  }
});

test('journey 2: an editor creates and edits records and filters the grid', async ({ page }) => {
  const api = await Api.forNewProject('m19b');
  try {
    const team = await api.dataset('Team', TEAM_CDL, 'name');
    const members = await api.recordSet(team.uuid, 'Members');
    await api.record(team.uuid, members.uuid, { name: 'Ada', role: 'lead', level: 3 });
    await api.record(team.uuid, members.uuid, { name: 'Bob', role: 'dev', level: 1 });

    await login(page);
    await navigate(page, `/p/${api.projectKey}/content`);
    // The store lists record sets; the Team chip narrows them to the dataset's.
    await page.locator('sf-content').getByRole('radio', { name: /Team/ }).click();
    await page.locator('sf-content').getByRole('link', { name: /Members/ }).click();
    const setView = page.locator('sf-record-set-view');
    await expect(setView.getByRole('heading', { name: 'Members' })).toBeVisible();
    const grid = setView.locator('sf-record-grid');
    await expect(grid.locator('tbody tr')).toHaveCount(2);

    // A new record opens in the record editor at once, named by its uuid until its title field is set.
    await setView.getByRole('button', { name: 'New record' }).click();
    await expect(page.locator('sf-record-editor h2')).toHaveText(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    // Autosave: the title field names the record.
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/records/'));
    await field(page, 'Name').fill('Cy Young');
    await field(page, 'Role').fill('lead');
    expect((await saved).status()).toBe(200);
    await expect(page.locator('sf-record-editor .record-editor__status')).toContainText('Saved', { timeout: 10_000 });
    await expect(page.locator('sf-record-editor h2')).toHaveText('Cy Young');
    await snap(page, 'j2-record-autosaved');

    // Back to the set's grid (breadcrumb): filter with a where expression.
    await page.locator('sf-record-editor').getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Members' }).click();
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    const filter = grid.getByPlaceholder(/Filter/);
    await filter.fill("role == 'lead' )");
    await filter.press('Enter');
    await expect(grid.locator('.record-grid__error')).toContainText('column 16');
    await filter.fill("role == 'lead'");
    await filter.press('Enter');
    await expect(grid.locator('tbody tr')).toHaveCount(2);
    await expect(grid.locator('tbody')).toContainText('Cy Young');
    await expect(grid.locator('tbody')).not.toContainText('Bob');

    // Sort by level via the header (keyboard).
    await grid.getByRole('button', { name: 'Level' }).focus();
    await page.keyboard.press('Enter');
    await expect(grid.locator('th[aria-sort="ascending"]')).toContainText('Level');
    await snap(page, 'j2-grid-filtered');
  } finally {
    await api.dispose();
  }
});

test('journey 3: a reference editor picks a record and the preview renders its value', async ({ page }) => {
  const api = await Api.forNewProject('m19c');
  try {
    const team = await api.dataset('Team', TEAM_CDL, 'name');
    const members = await api.recordSet(team.uuid, 'Members');
    await api.record(team.uuid, members.uuid, { name: 'Ada Lovelace', role: 'lead' });
    await api.dataset('Products', 'content { editor text sku { label "SKU" } }');
    const tpl = await api.pageTemplate(
      'Profile',
      'content {\n  editor reference person { label "Person" dataset "team" }\n}\n',
      '<h1 id="who">$CMS_VALUE(person.name)$</h1><p>$CMS_VALUE(person.role)$</p>',
    );
    const profile = await api.page('Profile', tpl.uuid);

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages/${profile.uuid}`);
    await page.locator('sf-reference-editor').getByRole('button', { name: /^Person/ }).click();
    const picker = page.locator('sf-asset-picker-dialog');
    // Restricted to the team dataset: records only, no type or dataset switch.
    await expect(picker.getByRole('combobox', { name: 'Asset type' })).toHaveCount(0);
    await expect(picker.getByRole('combobox', { name: 'Dataset' })).toHaveCount(0);
    await picker.getByRole('button', { name: /Ada Lovelace/ }).click();
    await expect(page.locator('sf-reference-editor')).toContainText('Ada Lovelace');

    await expect(previewBody(page)).toContainText('Ada Lovelace', { timeout: 15_000 });
    await expect(previewBody(page)).toContainText('lead');
    await snap(page, 'j3-record-in-preview');
  } finally {
    await api.dispose();
  }
});

test('journey 4: time travel before a record edit is read-only and shows the old value', async ({ page }) => {
  const api = await Api.forNewProject('m19d');
  try {
    const team = await api.dataset('Team', TEAM_CDL, 'name');
    const members = await api.recordSet(team.uuid, 'Members');
    const ada = await api.record(team.uuid, members.uuid, { name: 'Ada', role: 'dev' });
    const tpl = await api.pageTemplate(
      'Leads',
      '',
      '<ul>$CMS_FOR(m : dataset:team, where="m.role == \'lead\'")$<li>$CMS_VALUE(m.name)$</li>$CMS_END_FOR$</ul>',
    );
    const leads = await api.page('Leads', tpl.uuid);
    const before = (await api.revisions())[0].revisionId as number;
    await api.updateRecord(ada.uuid, { name: 'Ada', role: 'lead' });

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages/${leads.uuid}`);
    await expect(previewBody(page)).toContainText('Ada', { timeout: 15_000 });

    await page
      .locator('sf-revision-spine')
      .getByRole('button', { name: new RegExp(`^Revision ${before} ·`) })
      .click();
    await expect(page.locator('.shell__timemachine')).toContainText(`Viewing revision ${before}`);

    await navigate(page, `/p/${api.projectKey}/content/records/${ada.uuid}`);
    const editor = page.locator('sf-record-editor');
    await expect(editor.getByText(/read-only until you leave time travel/)).toBeVisible();
    await expect(field(page, 'Role')).toHaveValue('dev');
    await expect(field(page, 'Role')).toBeDisabled();
    await snap(page, 'j4-record-time-travel');

    await navigate(page, `/p/${api.projectKey}/pages/${leads.uuid}`);
    await expect(previewBody(page).locator('ul')).toBeAttached({ timeout: 15_000 });
    await expect(previewBody(page)).not.toContainText('Ada');
  } finally {
    await api.dispose();
  }
});
