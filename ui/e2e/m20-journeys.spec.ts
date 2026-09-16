import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * M20 template inheritance journey (feature `docs-e2e`, `M20.5.1`) — "a layout change re-renders every descendant
 * page":
 *   1. a developer builds abstract `base` (blocks `content`, `footer`) → abstract `docs_layout` (overrides `content`
 *      with `$CMS_PARENT$`) → `article` in the Templates store; a typo'd block override shows `SF-TPL-0157` live, the
 *      breadcrumb shows the chain and the inherited editors are listed;
 *   2. an editor creates a page on `article`; the create dialog doesn't offer `base` or `docs_layout`;
 *   3. the page preview shows all three layers;
 *   4. a FULL generation succeeds;
 *   5. the developer changes `base`'s footer and runs INCREMENTAL generation: the page is rebuilt with the new footer;
 *   6. the developer adds an editor to `base` that collides with one `article` declares: the save is rejected and the
 *      grandchild is listed.
 *
 * Self-seeding like the M16–M19 journeys: it creates its own project through the REST API and only needs a running
 * dev backend with an instance admin.
 *
 * Prerequisites:
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev SF_OUTPUT_ROOT=<dir> ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`
 *     (port 8081, instance admin `Admin` / `Admin`).
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<same dir as SF_OUTPUT_ROOT> npx playwright test e2e/m20-journeys.spec.ts`.
 *     Without `SF_E2E_OUTPUT_ROOT` steps 4–5 check the runs and plans but not the generated files.
 *
 * The access token is memory-only: after the login every navigation goes through the router.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';
const OUTPUT_ROOT = process.env['SF_E2E_OUTPUT_ROOT'];

test.use({ baseURL: BASE_URL });

type Json = Record<string, any>;

const BASE_CDL = 'content {\n  editor text title { label "Title" }\n}\n';
const BASE_HTML =
  '<html><body><h1 class="base">$CMS_VALUE(title)$</h1>\n' +
  '<main>$CMS_BLOCK(content)$<p class="base-content">base content</p>$CMS_END_BLOCK$</main>\n' +
  '<footer>$CMS_BLOCK(footer)$footer v1$CMS_END_BLOCK$</footer></body></html>';
const DOCS_HTML =
  '$CMS_EXTENDS(page_template:base)$\n' +
  '$CMS_BLOCK(content)$<div class="docs">$CMS_PARENT$</div>$CMS_END_BLOCK$';
const ARTICLE_CDL = 'content {\n  editor text summary { label "Summary" }\n}\n';
const ARTICLE_HTML =
  '$CMS_EXTENDS(page_template:docs_layout)$\n' +
  '$CMS_BLOCK(content)$<article>$CMS_PARENT$<p class="summary">$CMS_VALUE(summary)$</p></article>$CMS_END_BLOCK$';

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
    await api.post('/api/v1/projects', { key, name: `M20 ${prefix}` });
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

  async pageTemplates(): Promise<Json[]> {
    return (await this.get('/page-templates')).content;
  }

  async templateByUid(uid: string): Promise<Json> {
    const summary = (await this.pageTemplates()).find((t) => t.uid === uid);
    expect(summary, `page template ${uid}`).toBeTruthy();
    return this.get(`/page-templates/${summary!.uuid}`);
  }

  target(): Promise<Json> {
    return this.post('/targets', { name: 'default', type: 'FILESYSTEM', config: {}, isDefault: true });
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

function builtFile(projectKey: string, targetId: number, runId: number, file: string): string {
  return fs.readFileSync(path.join(OUTPUT_ROOT!, projectKey, `target-${targetId}`, 'builds', String(runId), file), 'utf8');
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

function templates(page: Page) {
  return page.locator('sf-templates');
}

/** Creates a page template through the Templates store: name, CDL + abstract flag, then its html channel. */
async function createTemplateInUi(
  page: Page,
  name: string,
  cdl: string,
  abstractTemplate: boolean,
  htmlSource: string,
): Promise<void> {
  const screen = templates(page);
  await screen.getByRole('button', { name: 'New template', exact: true }).click();
  await page.locator('sf-create-asset-dialog input').first().fill(name);
  await page.locator('sf-create-asset-dialog').getByRole('button', { name: /create/i }).click();
  await expect(screen.locator('.detail__head h3')).toHaveText(name);

  await screen.getByLabel('Content definition (CDL)').fill(cdl);
  if (abstractTemplate) {
    await screen.getByRole('checkbox', { name: 'Abstract' }).check();
  }
  const savedDefinition = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/page-templates/'));
  await screen.getByRole('button', { name: 'Save template', exact: true }).click();
  expect((await savedDefinition).status()).toBe(200);

  const addedChannel = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/channels/html'));
  await screen.getByRole('combobox', { name: 'Add channel' }).selectOption('html');
  expect((await addedChannel).status()).toBe(200);

  const channel = screen.locator('textarea[aria-describedby="octl-diagnostics"]');
  await expect(channel).toBeVisible();
  await channel.fill(htmlSource);
  const savedChannel = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/channels/html'));
  await screen.getByRole('button', { name: 'Save channel', exact: true }).click();
  const channelResponse = await savedChannel;
  expect(channelResponse.status(), await channelResponse.text()).toBe(200);
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey: a layout change re-renders every descendant page', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await Api.forNewProject('m20a');
  try {
    await login(page);
    await navigate(page, `/p/${api.projectKey}/templates`);
    const screen = templates(page);
    await expect(screen.getByRole('treeitem', { name: /Page Templates/ })).toBeVisible();

    // 1. base (abstract) → docs_layout (abstract) → article, built in the UI.
    await createTemplateInUi(page, 'Base', BASE_CDL, true, BASE_HTML);
    await createTemplateInUi(page, 'Docs Layout', '', true, DOCS_HTML);
    await expect(screen.getByRole('navigation', { name: 'Inheritance chain' })).toContainText('base');

    await createTemplateInUi(page, 'Article', ARTICLE_CDL, false, ARTICLE_HTML);
    await expect(screen.getByRole('navigation', { name: 'Inheritance chain' })).toHaveText(/base\s*›\s*docs_layout\s*›\s*article/);
    await expect(screen.getByRole('region', { name: 'Inherited editors and bodies' })).toContainText('title');

    // A typo'd block name warns live, with a suggestion; fixing it clears the warning.
    const channel = screen.locator('textarea[aria-describedby="octl-diagnostics"]');
    await channel.fill(ARTICLE_HTML.replace('$CMS_BLOCK(content)$', '$CMS_BLOCK(contnet)$'));
    await expect(screen.locator('#octl-diagnostics')).toContainText('SF-TPL-0157', { timeout: 10_000 });
    await expect(screen.locator('#octl-diagnostics')).toContainText("did you mean 'content'");
    await snap(page, 'j1-typo-warning');
    await channel.fill(ARTICLE_HTML);
    await expect(screen.locator('#octl-diagnostics .diagnostic')).toHaveCount(0, { timeout: 10_000 });

    const base = await api.templateByUid('base');
    const docs = await api.templateByUid('docs_layout');
    const article = await api.templateByUid('article');
    expect(base.abstract).toBe(true);
    expect(docs.abstract).toBe(true);
    expect(docs.parentTemplateRef).toBe(base.uuid);
    expect(article.parentTemplateRef).toBe(docs.uuid);
    expect(article.abstract).toBe(false);

    // 2. An editor creates a page on article; the layouts aren't offered.
    await navigate(page, `/p/${api.projectKey}/pages`);
    await page.locator('sf-pages-list').getByRole('button', { name: 'New page' }).click();
    const dialog = page.locator('sf-create-asset-dialog');
    const options = await dialog.locator('select[formcontrolname="templateUuid"] option').allTextContents();
    expect(options).toContain('Article');
    expect(options).not.toContain('Base');
    expect(options).not.toContain('Docs Layout');
    await dialog.locator('input').first().fill('Guide');
    await dialog.locator('select[formcontrolname="templateUuid"]').selectOption({ label: 'Article' });
    const createdPage = page.waitForResponse((r) => r.request().method() === 'POST' && /\/pages$/.test(r.url()));
    await dialog.getByRole('button', { name: /create/i }).click();
    const created = await createdPage;
    expect(created.status(), await created.text()).toBe(200);
    const pageUuid = (await created.json()).uuid as string;
    await navigate(page, `/p/${api.projectKey}/pages/${pageUuid}`);
    await expect(page.locator('sf-page-editor')).toBeVisible({ timeout: 15_000 });

    // 3. The preview shows all three layers, with an inherited editor filled in the page form.
    const titleField = page.locator('sf-page-editor sf-field').filter({ hasText: 'Title' }).locator('input');
    await titleField.fill('Getting started');
    await page.locator('sf-page-editor sf-field').filter({ hasText: 'Summary' }).locator('input').fill('Read this first');
    const preview = previewBody(page);
    await expect(preview.locator('h1.base')).toHaveText('Getting started', { timeout: 20_000 });
    await expect(preview.locator('div.docs p.base-content')).toHaveText('base content');
    await expect(preview.locator('article p.summary')).toHaveText('Read this first');
    await expect(preview.locator('footer')).toHaveText('footer v1');
    await snap(page, 'j3-layered-preview');

    // 4. FULL generation.
    const target = await api.target();
    const full = await api.generate('FULL', target.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');
    if (OUTPUT_ROOT) {
      const html = builtFile(api.projectKey, target.id, full.id, 'guide.html');
      expect(html).toContain('<div class="docs"><p class="base-content">base content</p></div>');
      expect(html).toContain('<footer>footer v1</footer>');
    }

    // 5. The developer changes base's footer; INCREMENTAL rebuilds the page with it.
    const current = await api.templateByUid('base');
    await api.put(
      `/page-templates/${current.uuid}`,
      {
        displayName: current.displayName,
        contentDefinition: current.contentDefinition,
        channelSources: { html: BASE_HTML.replace('footer v1', 'footer v2') },
        outputPath: current.outputPath,
        abstract: true,
      },
      { 'If-Match': `"rev-${current.revision}"` },
    );
    const incremental = await api.generate('INCREMENTAL', target.id);
    expect(incremental.status, JSON.stringify(incremental.diagnostics)).toBe('SUCCESS');
    if (OUTPUT_ROOT) {
      expect(builtFile(api.projectKey, target.id, incremental.id, 'guide.html')).toContain('<footer>footer v2</footer>');
    }

    // 6. An editor added to base that article already declares: the save is rejected, naming the grandchild.
    await navigate(page, `/p/${api.projectKey}/templates`);
    await screen.getByRole('treeitem', { name: /Base/ }).first().click();
    await expect(screen.locator('.detail__head h3')).toHaveText('Base');
    await screen.getByLabel('Content definition (CDL)').fill(
      'content {\n  editor text title { label "Title" }\n  editor text summary { label "Summary" }\n}\n',
    );
    const rejected = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/page-templates/'));
    await screen.getByRole('button', { name: 'Save template', exact: true }).click();
    expect((await rejected).status()).toBe(422);
    const notice = screen.locator('.inheritance__notice--error');
    await expect(notice).toContainText('article');
    await expect(notice).toContainText('SF-CDL-0109');
    await snap(page, 'j6-descendant-rejected');
    expect((await api.templateByUid('base')).contentDefinition).not.toContain('summary');
  } finally {
    await api.dispose();
  }
});
