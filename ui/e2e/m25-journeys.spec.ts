import { test, expect, request as playwrightRequest, APIRequestContext, Locator, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { cdl } from './cdl';

/**
 * M25 record sets journey (feature `docs-e2e`, `M25.6.2`) — the whole feature in the running app:
 *   1. a developer creates dataset `team` (`name`, `role`, `joined`) with an `html` record template in the
 *      Templates store;
 *   2. an editor creates folder `staff`, record set `leadership` (dataset `team`) in it and adds three records
 *      through the set view;
 *   3. a developer (REST) adds `$CMS_VALUE(recordset:leadership)$` and a `reference` editor
 *      `featured { assetTypes [RECORD_SET] dataset "team" }` rendered with `$CMS_FOR(m : featured, limit=1)$` to
 *      a page template;
 *   4. the editor picks `leadership` in the page's `featured` editor (the picker lists only `team` sets); the
 *      preview renders every record in the default order;
 *   2b. the editor sets the query `where "role == 'lead'"`, `sort "-joined"` → "2 of 3", the grid dims the
 *      non-lead; the preview shows both renderings in the query's order;
 *   5. an INCREMENTAL generation after editing the non-lead record does not rebuild the page (no entry in the
 *      run's "Rebuilt pages"); editing a lead does, and the reason names the record and the set;
 *   6. the page, its template and the set are exported from the export picker — the dataset rides along as an
 *      implicit pick — and imported into a fresh project through the import screen: the preview is identical;
 *   7. time travel to before the query save: the query panel is read-only with no query, the grid lists the
 *      set of that revision undimmed, and the preview shows the unfiltered order.
 *
 * Step order: the query (2b) is saved after the page exists, because step 7 travels to "before the query save"
 * and needs a page to preview there — with the task's literal order the page didn't exist yet at that revision.
 *
 * Also asserts the 1280 px layout of the set view, query panel, grid and the dataset's record-template tab
 * (nothing overflowing its container or clipped by the viewport).
 *
 * Prerequisites (as for the M16–M24 journeys):
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev SF_OUTPUT_ROOT=<dir> ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<same dir as SF_OUTPUT_ROOT> npx playwright test e2e/m25-journeys.spec.ts`.
 *     Without `SF_E2E_OUTPUT_ROOT` the generated-file checks of step 5 are skipped (the plan checks still run).
 *
 * The access token is memory-only: after the login every navigation goes through the router.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';
const OUTPUT_ROOT = process.env['SF_E2E_OUTPUT_ROOT'];

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });

type Json = Record<string, any>;

const TEAM_CDL =
  'content {\n' +
  '  editor text name { label "Name" required }\n' +
  '  editor text role { label "Role" }\n' +
  '  editor date joined { label "Joined" }\n' +
  '}\n';

const RECORD_TEMPLATE = '<li class="member">$CMS_VALUE(name)$ · $CMS_VALUE(role)$</li>';

const PAGE_CDL = 'content {\n  editor reference featured { label "Featured" assetTypes [RECORD_SET] dataset "team" }\n}\n';

const PAGE_HTML =
  '<html><body><ul id="all">$CMS_VALUE(recordset:leadership)$</ul>' +
  '<p id="featured">$CMS_FOR(m : featured, limit=1)$<b>$CMS_VALUE(m.name)$</b>$CMS_END_FOR$</p></body></html>';

const MEMBERS = [
  { name: 'Ada', role: 'lead', joined: '2019-03-01' },
  { name: 'Linus', role: 'dev', joined: '2020-01-10' },
  { name: 'Grace', role: 'lead', joined: '2021-06-15' },
];

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
    await api.post('/api/v1/projects', { key, name: `M25 ${prefix}` });
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

  async text(p: string): Promise<string> {
    const res = await this.ctx.get(this.url(p));
    expect(res.ok(), `GET ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.text();
  }

  async updateRecord(uuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/records/${uuid}`);
    return this.put(`/records/${uuid}`, { content }, { 'If-Match': `"rev-${current.revision}"` });
  }

  async generate(mode: 'FULL' | 'INCREMENTAL', targetId: number): Promise<Json> {
    const started = await this.post('/generations', { mode, channels: ['html'], targetId });
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const run = await this.get(`/generations/${started.id}`);
      if (['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.status)) {
        return run;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`generation ${started.id} did not finish within 60s`);
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

const SHOTS_DIR = process.env['SF_E2E_SHOTS_DIR'];

async function snap(page: Page, name: string): Promise<void> {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (SHOTS_DIR) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.copyFileSync(file, path.join(SHOTS_DIR, `m25-${name}.png`));
  }
}

function recordField(page: Page, label: string): Locator {
  return page.locator('sf-record-editor sf-field').filter({ hasText: label }).locator('input');
}

/**
 * The 1280 px layout check `tasks/lessons.md` asks for: the element sits inside the viewport horizontally and
 * none of its descendants is wider than the box it scrolls in (nothing clipped or pushing the page sideways).
 */
async function expectLaidOut(locator: Locator, what: string): Promise<void> {
  await expect(locator, what).toBeVisible();
  const report = await locator.evaluate((root) => {
    const problems: string[] = [];
    const viewport = document.documentElement.clientWidth;
    const box = root.getBoundingClientRect();
    if (box.left < -0.5 || box.right > viewport + 0.5) {
      problems.push(`${root.tagName.toLowerCase()} spans ${box.left}..${box.right} of ${viewport}px`);
    }
    if (document.documentElement.scrollWidth > viewport + 0.5) {
      problems.push(`page scrolls sideways: ${document.documentElement.scrollWidth} > ${viewport}`);
    }
    const scrollsOnPurpose = (el: Element) => {
      const style = getComputedStyle(el);
      return ['auto', 'scroll'].includes(style.overflowX);
    };
    for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
      const html = el as HTMLElement;
      // Hidden elements, and the 1 px visually-hidden screen-reader texts, are clipped on purpose.
      if ((!html.offsetParent && getComputedStyle(html).position !== 'fixed') || html.classList.contains('sf-sr-only')) {
        continue;
      }
      if (html.scrollWidth > html.clientWidth + 1 && !scrollsOnPurpose(html) && html.clientWidth > 1) {
        const cls = typeof html.className === 'string' ? html.className : '';
        problems.push(`${html.tagName.toLowerCase()}.${cls.split(' ').join('.')} overflows ${html.scrollWidth} > ${html.clientWidth}`);
      }
      const rect = html.getBoundingClientRect();
      if (rect.width > 0 && rect.right > viewport + 0.5) {
        const cls = typeof html.className === 'string' ? html.className : '';
        problems.push(`${html.tagName.toLowerCase()}.${cls.split(' ').join('.')} ends at ${rect.right} > ${viewport}`);
      }
    }
    return problems;
  });
  expect(report, `${what} at 1280 px`).toEqual([]);
}

/** Lists a ZIP archive's entries (stored or deflated) — enough to read an export's `assets/<uuid>.json`. */
function unzip(buffer: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) {
    end--;
  }
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const dataStart = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(dataStart, dataStart + compressed);
    entries.set(name, (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8'));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey: record sets end to end', async ({ page }) => {
  test.setTimeout(300_000);
  const api = await Api.forNewProject('m25a');
  // Step 6's import target exists before the login: the session's project roles are read at login.
  const target = await Api.forNewProject('m25b');
  try {
    await login(page);

    // ── 1. Developer: dataset `team` with an html record template ─────────
    await navigate(page, `/p/${api.projectKey}/templates?kind=DATASET`);
    const templates = page.locator('sf-templates');
    await expect(templates.getByRole('treeitem', { name: /Datasets/ })).toBeVisible();
    await templates.getByRole('button', { name: 'New dataset' }).click();
    await page.locator('sf-create-asset-dialog input').first().fill('Team');
    await page.locator('sf-create-asset-dialog').getByRole('button', { name: /create/i }).click();

    const datasetEditor = page.locator('sf-dataset-schema-editor');
    await expect(datasetEditor.locator('h3')).toHaveText('Team');
    // The Content tab beside the record templates (M34): both are on screen at once.
    await datasetEditor.getByRole('textbox', { name: 'Record fields (CDL) — Content' }).fill(cdl(TEAM_CDL).contentCdl);
    await datasetEditor.getByRole('tab', { name: /^html/ }).click();
    const recordTemplate = datasetEditor.getByRole('textbox', { name: 'Record template for channel html' });
    await expect(datasetEditor.getByRole('note')).toContainText('No record template for html');
    await recordTemplate.fill(RECORD_TEMPLATE);
    // The new fields are offered as insert helpers before the schema is even saved.
    await expect(datasetEditor.getByRole('group', { name: 'Insert into the record template' })).toContainText('joined');
    await expectLaidOut(datasetEditor, 'dataset record-template tab');
    await snap(page, 'j1-record-template');
    await datasetEditor.getByRole('button', { name: 'Save dataset' }).click();
    await expect(datasetEditor.getByRole('button', { name: 'Save dataset' })).toBeDisabled({ timeout: 10_000 });
    await expect(datasetEditor.locator('.octl-editor__diagnostics .diagnostic')).toHaveCount(0);

    // The saved schema's first text field became the title field: records are named after `name`.
    await expect(datasetEditor.getByRole('combobox', { name: /^Title field/ })).toHaveValue('name');

    const datasets = await api.get('/datasets');
    expect(datasets).toHaveLength(1);
    const team = await api.get(`/datasets/${datasets[0].uuid}`);
    expect(team.uid).toBe('team');
    expect(team.titleEditor).toBe('name');
    expect(team.channelTemplates.html.source).toBe(RECORD_TEMPLATE);

    // ── 2. Editor: folder `staff`, set `leadership`, three records ─────────
    await navigate(page, `/p/${api.projectKey}/content`);
    const content = page.locator('sf-content');
    await content.getByRole('button', { name: 'New folder' }).click();
    await page.locator('sf-create-asset-dialog input').first().fill('staff');
    await page.locator('sf-create-asset-dialog').getByRole('button', { name: /create/i }).click();
    await content.getByRole('treeitem', { name: /staff/ }).click();
    await content.getByRole('complementary').getByRole('button', { name: 'New record set' }).click();
    const createSet = page.locator('sf-create-asset-dialog');
    await createSet.getByRole('textbox', { name: 'Name', exact: true }).fill('Leadership');
    await expect(createSet.getByRole('textbox', { name: /^UID/ })).toHaveValue('leadership');
    await expect(createSet.getByRole('combobox', { name: /^Dataset/ })).toHaveValue(team.uuid);
    await createSet.getByRole('button', { name: /create/i }).click();

    const setView = page.locator('sf-record-set-view');
    await expect(setView.getByRole('heading', { name: 'Leadership' })).toBeVisible({ timeout: 10_000 });
    await expect(setView.locator('.set-view__crumbs')).toContainText('staff');
    const sets = await api.get('/record-sets');
    expect(sets).toHaveLength(1);
    const leadership = sets[0];
    expect(leadership.uid).toBe('leadership');
    expect(leadership.folderPath).toContain('staff');

    const grid = setView.locator('sf-record-grid');
    for (const member of MEMBERS) {
      await setView.getByRole('button', { name: 'New record' }).click();
      const recordEditor = page.locator('sf-record-editor');
      await expect(recordEditor.locator('h2')).toHaveText(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      await expect(recordEditor.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Leadership');
      const saved = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes('/records/') && r.ok(),
      );
      await recordField(page, 'Name').fill(member.name);
      await recordField(page, 'Role').fill(member.role);
      await recordField(page, 'Joined').fill(member.joined);
      await saved;
      await expect(recordEditor.locator('.record-editor__status')).toContainText('Saved', { timeout: 10_000 });
      await expect(recordEditor.locator('h2')).toHaveText(member.name);
      await recordEditor.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Leadership' }).click();
      await expect(setView.getByRole('heading', { name: 'Leadership' })).toBeVisible();
    }
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    const records: Json[] = (await api.get(`/record-sets/${leadership.uuid}/records`)).content;
    const byName = new Map(records.map((r) => [r.displayName as string, r]));
    for (const member of MEMBERS) {
      expect(byName.get(member.name)?.values).toMatchObject({ role: member.role, joined: member.joined });
    }

    // ── 3. Developer: the page template renders the set two ways ───────────
    const pageTemplate = await api.post('/page-templates', {
      displayName: 'Team page',
      ...cdl(PAGE_CDL),
      channelSources: { html: PAGE_HTML },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const teamPage = await api.post('/pages', { displayName: 'Team', templateUuid: pageTemplate.uuid });
    // A second set of another dataset must not be offered by the `team`-restricted picker.
    const products = await api.post('/datasets', {
      displayName: 'Products',
      ...cdl('content { editor text sku { label "SKU" } }'),
    });
    await api.post('/record-sets', { datasetUuid: products.uuid, displayName: 'Catalogue' });

    // ── 4. Editor: picks `leadership` in `featured`; unfiltered preview ─────
    await navigate(page, `/p/${api.projectKey}/pages/${teamPage.uuid}`);
    const reference = page.locator('sf-reference-editor');
    await reference.getByRole('button', { name: /^Featured/ }).click();
    const picker = page.locator('sf-asset-picker-dialog');
    // `assetTypes [RECORD_SET] dataset "team"`: record sets only, and only `team`'s.
    await expect(picker.getByRole('combobox', { name: 'Asset type' })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: /Leadership/ })).toBeVisible({ timeout: 10_000 });
    await expect(picker.getByRole('button', { name: /Catalogue/ })).toHaveCount(0);
    await expect(picker.getByRole('button', { name: /Leadership/ })).toContainText('3 records');
    // The dataset badge sits next to the set's name, sized to its text (it used to stretch across the row).
    const pickRow = picker.getByRole('button', { name: /Leadership/ });
    const nameBox = (await pickRow.getByText('Leadership', { exact: true }).boundingBox())!;
    const badgeBox = (await pickRow.getByText('Team', { exact: true }).boundingBox())!;
    expect(Math.abs(nameBox.y + nameBox.height / 2 - (badgeBox.y + badgeBox.height / 2))).toBeLessThan(4);
    expect(badgeBox.x).toBeGreaterThan(nameBox.x + nameBox.width);
    expect(badgeBox.width).toBeLessThan(120);
    await expectLaidOut(picker.getByRole('dialog'), 'record-set picker');
    await snap(page, 'j4-picker-team-sets');
    const autosaved = page.waitForResponse(
      (r) => r.url().includes(`/pages/${teamPage.uuid}`) && ['PUT', 'PATCH'].includes(r.request().method()) && r.ok(),
      { timeout: 15_000 },
    );
    await picker.getByRole('button', { name: /Leadership/ }).click();
    await autosaved;
    await expect(reference).toContainText('Leadership');
    await expect(reference).toContainText('Team');
    await expect(reference).toContainText('3 records');
    // No query yet: every record, default order (by name).
    await expect(previewBody(page).locator('#all li')).toHaveText(['Ada · lead', 'Grace · lead', 'Linus · dev'], {
      timeout: 15_000,
    });
    await expect(previewBody(page).locator('#featured')).toHaveText('Ada');
    await snap(page, 'j4-preview-unfiltered');
    const beforeQuery = (await api.get('/revisions'))[0].revisionId as number;

    // ── 2b. Editor: the set query → 2 of 3, dimming, filtered preview ──────
    await navigate(page, `/p/${api.projectKey}/content/sets/${leadership.uuid}`);
    await expect(setView.getByRole('heading', { name: 'Leadership' })).toBeVisible();
    const queryPanel = setView.locator('sf-record-set-query-panel');
    await queryPanel.getByRole('textbox', { name: 'Where' }).fill("role == 'lead'");
    await queryPanel.getByRole('button', { name: 'Add sort key' }).click();
    await queryPanel.getByRole('combobox', { name: 'Sort key 1 field' }).selectOption('joined');
    await queryPanel.getByRole('combobox', { name: 'Sort key 1 direction' }).selectOption('desc');
    await expect(queryPanel.getByRole('status')).toContainText('2 of 3 records match', { timeout: 10_000 });
    await expectLaidOut(setView, 'set view with the query panel');
    await snap(page, 'j2-query-draft');
    const querySaved = page.waitForResponse(
      (r) => r.url().includes(`/record-sets/${leadership.uuid}`) && r.request().method() === 'PUT' && r.ok(),
    );
    await queryPanel.getByRole('button', { name: 'Save query' }).click();
    await querySaved;
    await expect(queryPanel.getByRole('button', { name: 'Save query' })).toBeDisabled();
    const storedSet = await api.get(`/record-sets/${leadership.uuid}`);
    expect(storedSet.query).toEqual({ where: "role == 'lead'", sort: '-joined' });

    // The grid reflects the query: "All records" dims the non-lead, "Show as rendered" lists the set's order.
    await expect(grid.locator('tbody tr')).toHaveCount(3);
    // The title field (`name`) is the record's name: one Name column, not two.
    await expect(grid.getByRole('columnheader', { name: 'Name' })).toHaveCount(1);
    await expect(grid.locator('tbody tr.record-grid__row--excluded')).toHaveCount(1);
    await expect(grid.locator('tbody tr.record-grid__row--excluded')).toContainText('Linus');
    await expectLaidOut(grid, 'record grid');
    await snap(page, 'j2-grid-dimmed');
    await grid.getByRole('radio', { name: 'Show as rendered' }).click();
    await expect(grid.locator('tbody tr td.record-grid__name')).toHaveText(['Grace', 'Ada']);
    await snap(page, 'j2-grid-as-rendered');

    await navigate(page, `/p/${api.projectKey}/pages/${teamPage.uuid}`);
    await expect(previewBody(page).locator('#all li')).toHaveText(['Grace · lead', 'Ada · lead'], { timeout: 15_000 });
    await expect(previewBody(page).locator('#featured')).toHaveText('Grace');
    await snap(page, 'j4-preview-filtered');

    // ── 5. Incremental generation prunes by the set query ─────────────────
    const site = await api.post('/targets', {
      name: 'Site',
      type: 'FILESYSTEM',
      config: { baseUrl: 'https://example.com' },
      isDefault: true,
    });
    const full = await api.generate('FULL', site.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');

    const linus = byName.get('Linus')!;
    await api.updateRecord(linus.uuid, { name: 'Linus T.', role: 'dev', joined: '2020-01-10' });
    const nonLead = await api.generate('INCREMENTAL', site.id);
    expect(nonLead.status, JSON.stringify(nonLead.diagnostics)).toBe('SUCCESS');

    await navigate(page, `/p/${api.projectKey}/settings/generation`);
    const generation = page.locator('sf-generation');
    const nonLeadRow = generation.locator('tbody tr', { hasText: `#${nonLead.id}` });
    await expect(nonLeadRow).toBeVisible({ timeout: 15_000 });
    await nonLeadRow.getByRole('button', { name: 'Details' }).click();
    await generation.getByRole('tab', { name: 'Rebuilt pages' }).click();
    const details = generation.locator('.details-row');
    await expect(details.getByRole('tabpanel')).toBeVisible();
    await expect(details.locator('sf-plan-entries-table td.entries__path', { hasText: 'team.html' })).toHaveCount(0);
    await snap(page, 'j5-non-lead-not-rebuilt');

    const ada = byName.get('Ada')!;
    await api.updateRecord(ada.uuid, { name: 'Ada L.', role: 'lead', joined: '2019-03-01' });
    const lead = await api.generate('INCREMENTAL', site.id);
    expect(lead.status, JSON.stringify(lead.diagnostics)).toBe('SUCCESS');
    await navigate(page, `/p/${api.projectKey}/settings/pages`);
    await navigate(page, `/p/${api.projectKey}/settings/generation`);
    const leadRow = generation.locator('tbody tr', { hasText: `#${lead.id}` });
    await expect(leadRow).toBeVisible({ timeout: 15_000 });
    await leadRow.getByRole('button', { name: 'Details' }).click();
    await generation.getByRole('tab', { name: 'Rebuilt pages' }).click();
    const leadEntries = details.locator('sf-plan-entries-table tbody tr:not(.entries__detail)');
    await expect(leadEntries.locator('td.entries__path')).toHaveText(['team.html']);
    await leadEntries.first().getByRole('button', { name: /Changed|Show chain/ }).click();
    const chain = details.getByRole('list', { name: /Why this is rebuilt/ });
    await expect(chain).toContainText(`record:${ada.uid}`);
    await expect(chain).toContainText('reads record set containing');
    await expect(chain).toContainText('leadership');
    await snap(page, 'j5-lead-rebuilt');

    if (OUTPUT_ROOT) {
      const build = path.join(OUTPUT_ROOT, api.projectKey, `target-${site.id}`, 'builds', String(lead.id));
      const html = fs.readFileSync(path.join(build, 'team.html'), 'utf8');
      expect(html).toContain('<li class="member">Grace · lead</li><li class="member">Ada L. · lead</li>');
      expect(html).toContain('<p id="featured"><b>Grace</b></p>');
    }

    // ── 6. Export page + template + set, import into a fresh project ───────
    const sourcePreview = await api.text(`/preview/pages/${teamPage.uuid}`);
    await navigate(page, `/p/${api.projectKey}/settings/import-export`);
    const exporter = page.locator('sf-project-settings-export');
    const scope = (heading: string) =>
      exporter.locator('.tree-section').filter({ has: page.getByRole('heading', { name: heading, exact: true }) });
    await expect(scope('Pages').getByRole('checkbox', { name: 'Team', exact: true })).toBeVisible({ timeout: 15_000 });
    // The `staff` folder was created in the Content screen of this session: the picker must know it.
    await expandAll(exporter);
    await scope('Pages').getByRole('checkbox', { name: 'Team', exact: true }).check();
    await scope('Templates').getByRole('checkbox', { name: 'Team page', exact: true }).check();
    // The Content scope lists the set under its folder, never its records.
    await expect(scope('Content').getByRole('treeitem', { name: /staff/ })).toBeVisible();
    await expect(scope('Content').getByText('Ada', { exact: true })).toHaveCount(0);
    await scope('Content').getByRole('checkbox', { name: 'Leadership', exact: true }).check();
    await expect(exporter.getByText('A record set is exported with its records and its dataset.')).toBeVisible();
    await snap(page, 'j6-export-picker');
    const download = page.waitForEvent('download');
    await exporter.getByRole('button', { name: 'Export', exact: true }).click();
    const archivePath = test.info().outputPath('m25-selection.zip');
    await (await download).saveAs(archivePath);

    const archive = unzip(fs.readFileSync(archivePath));
    const exported = [...archive.entries()]
      .filter(([name]) => name.startsWith('assets/'))
      .map(([, json]) => JSON.parse(json) as Json);
    const exportedOf = (type: string) => exported.filter((a) => a.type === type);
    expect(exportedOf('PAGE').map((a) => [a.uid, a.explicit])).toEqual([['team', true]]);
    expect(exportedOf('PAGE_TEMPLATE').map((a) => a.explicit)).toEqual([true]);
    expect(exportedOf('RECORD_SET').map((a) => [a.uid, a.explicit])).toEqual([['leadership', true]]);
    expect(exportedOf('RECORD').map((a) => a.explicit)).toEqual([true, true, true]);
    // The dataset joins as an implicit pick (and so does the set's folder), never the unpicked `products`.
    expect(exportedOf('DATASET').map((a) => [a.uid, a.explicit])).toEqual([['team', false]]);
    expect(exportedOf('FOLDER').find((a) => a.displayName === 'staff')?.explicit).toBe(false);
    expect(exportedOf('DATASET').map((a) => a.payload.channelTemplates.html.source)).toEqual([RECORD_TEMPLATE]);

    await navigate(page, `/p/${target.projectKey}/settings/import-export`);
    // The screen is reused across projects: wait until it shows the (empty) target before loading the archive.
    await expect(scope('Content').getByRole('heading', { name: 'No record sets' })).toBeVisible();
    const importer = page.locator('sf-project-settings-import');
    await importer.locator('input[type="file"]').setInputFiles(archivePath);
    await expect(importer.getByRole('button', { name: /^Import/ })).toBeEnabled({ timeout: 20_000 });
    await importer.getByRole('button', { name: /^Import/ }).scrollIntoViewIfNeeded();
    await snap(page, 'j6-import-report');
    await importer.getByRole('button', { name: /^Import/ }).click();
    await expect(importer.getByRole('status')).toContainText('Imported', { timeout: 20_000 });

    const importedPreview = await target.text(`/preview/pages/${teamPage.uuid}`);
    expect(importedPreview).toBe(sourcePreview);
    await navigate(page, `/p/${target.projectKey}/pages/${teamPage.uuid}`);
    await expect(previewBody(page).locator('#all li')).toHaveText(['Grace · lead', 'Ada L. · lead'], {
      timeout: 15_000,
    });
    await expect(previewBody(page).locator('#featured')).toHaveText('Grace');
    await snap(page, 'j6-imported-preview');

    // ── 7. Time travel to before the query save ────────────────────────────
    await navigate(page, `/p/${api.projectKey}/content/sets/${leadership.uuid}`);
    await expect(setView.getByRole('heading', { name: 'Leadership' })).toBeVisible();
    await page
      .locator('sf-revision-spine')
      .getByRole('button', { name: new RegExp(`^Revision ${beforeQuery} ·`) })
      .click();
    await expect(page.locator('.shell__timemachine')).toContainText(`Viewing revision ${beforeQuery}`);
    // The revision's diff names the set the page picked — the last change before the query save.
    await expect(page.getByRole('main').getByRole('link', { name: 'Leadership' })).toBeVisible();
    await navigate(page, `/p/${api.projectKey}/content/sets/${leadership.uuid}`);
    await expect(setView.getByRole('heading', { name: 'Leadership' })).toBeVisible();
    await expect(setView.getByRole('status').filter({ hasText: 'read-only' })).toBeVisible();
    await expect(queryPanel.getByRole('textbox', { name: 'Where' })).toBeDisabled();
    await expect(queryPanel.getByRole('textbox', { name: 'Where' })).toHaveValue('');
    await expect(queryPanel.getByRole('button', { name: 'Save query' })).toHaveCount(0);
    await expect(queryPanel.getByRole('button', { name: 'Add sort key' })).toHaveCount(0);
    // The grid lists the set as it was then: original names, nothing dimmed (no query yet).
    await expect(grid.locator('tbody td.record-grid__name')).toHaveText(['Ada', 'Grace', 'Linus']);
    await expect(grid.locator('tbody tr.record-grid__row--excluded')).toHaveCount(0);
    await expectLaidOut(setView, 'set view in time travel');
    await snap(page, 'j7-set-time-travel');

    await navigate(page, `/p/${api.projectKey}/pages/${teamPage.uuid}`);
    await expect(previewBody(page).locator('#all li')).toHaveText(['Ada · lead', 'Grace · lead', 'Linus · dev'], {
      timeout: 15_000,
    });
    await expect(previewBody(page).locator('#featured')).toHaveText('Ada');
    await snap(page, 'j7-preview-time-travel');
  } finally {
    await api.dispose();
    await target.dispose();
  }
});

/** Expands every collapsed folder row of the export picker until none is left. */
async function expandAll(exporter: Locator): Promise<void> {
  const collapsed = exporter.getByRole('button', { name: 'Expand folder' });
  for (let guard = 0; guard < 30 && (await collapsed.count()) > 0; guard++) {
    await collapsed.first().click();
  }
}
