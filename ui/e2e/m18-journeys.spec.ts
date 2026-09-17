import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * M18 processed text media journeys (feature `docs-e2e`, `M18.5.1`):
 *   1. upload → enable → edit → preview → generate: `site.css` reads `global:site.brandColor`; the
 *      editor switches processing on in the media drawer, sees a live error for `$CMS_BODY`, jumps to
 *      it, fixes the source and saves (a revision on the spine), checks the Rendered tab, the page
 *      preview's computed style, a FULL generation and an INCREMENTAL one after the global changes;
 *   2. time travel shows the historical source read-only, and closing the drawer with unsaved
 *      source edits asks first.
 *
 * Self-seeding like `m16-journeys.spec.ts` / `m17-journeys.spec.ts`: each journey creates its own
 * project through the REST API, so it only needs a running dev backend with an instance admin.
 *
 * Prerequisites:
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev SF_OUTPUT_ROOT=<dir> ./gradlew :server:sf-app:bootRun` (port 8081,
 *     seeded instance admin `Admin` / `Admin`).
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<same dir as SF_OUTPUT_ROOT> npx playwright test e2e/m18-journeys.spec.ts`.
 *
 * The access token is memory-only: `page.goto` to a deep link drops the session, so after the
 * login every navigation goes through the router (`history.pushState` + `popstate`).
 *
 * Incremental builds stage only the files a run produces (the carry-forward of unchanged files is
 * `M22.4.1`), so step 7 asserts on the re-rendered stylesheet only, not on the whole site.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';
const OUTPUT_ROOT = process.env['SF_E2E_OUTPUT_ROOT'];

test.use({ baseURL: BASE_URL });

type Json = Record<string, any>;

const SITE_CDL = 'content {\n  editor text brandColor { label "Brand color" }\n}\n';

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
    await api.post('/api/v1/projects', { key, name: `M18 ${prefix}` });
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

  async uploadText(fileName: string, mimeType: string, text: string): Promise<Json> {
    const res = await this.ctx.post(this.url('/media'), {
      multipart: { file: { name: fileName, mimeType, buffer: Buffer.from(text, 'utf8') } },
    });
    expect(res.ok(), `upload → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  pageTemplate(displayName: string, source: string): Promise<Json> {
    return this.post('/page-templates', {
      displayName,
      contentDefinition: '',
      channelSources: { html: source },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
  }

  page(displayName: string, templateUuid: string): Promise<Json> {
    return this.post('/pages', { displayName, templateUuid });
  }

  async globalSet(displayName: string, contentDefinition: string, content: Json): Promise<Json> {
    const set = await this.post('/globals', { displayName, contentDefinition });
    return this.put(`/globals/${set.uuid}/content`, { content }, { 'If-Match': `"rev-${set.revision}"` });
  }

  async setValues(uuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/globals/${uuid}`);
    return this.put(`/globals/${uuid}/content`, { content }, { 'If-Match': `"rev-${current.revision}"` });
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

  async revisions(): Promise<Json[]> {
    return this.get('/revisions');
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

function builtFile(projectKey: string, targetId: number, runId: number, file: string): string {
  return fs.readFileSync(
    path.join(OUTPUT_ROOT!, projectKey, `target-${targetId}`, 'builds', String(runId), file),
    'utf8',
  );
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

function drawer(page: Page) {
  return page.locator('sf-media-detail-drawer');
}

async function openMedia(page: Page, projectKey: string, name: string): Promise<void> {
  await navigate(page, `/p/${projectKey}/media`);
  await page.locator('sf-media-library .cell__body', { hasText: name }).click();
  await expect(drawer(page).locator('.drawer__title')).toContainText(name);
}

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey 1: a stylesheet is processed, edited, previewed and generated', async ({ page }) => {
  test.skip(!OUTPUT_ROOT, 'reads generated files: set SF_E2E_OUTPUT_ROOT');
  const api = await Api.forNewProject('m18a');
  try {
    // 1. Seed: global set `site`, the stylesheet, a page linking it, a target.
    const site = await api.globalSet('Site', SITE_CDL, { brandColor: '#c00' });
    const css = await api.uploadText('site.css', 'text/css', 'h1 { color: $CMS_VALUE(global:site.brandColor)$; }\n');
    const tpl = await api.pageTemplate(
      'Styled',
      '<html><head><link rel="stylesheet" href="$CMS_REF(media:site_css)$"></head><body><h1 id="t">Hello</h1></body></html>',
    );
    const home = await api.page('Home', tpl.uuid);
    const target = await api.target();

    // 2. Enable processing: no errors, the CMS badge appears.
    await login(page);
    await openMedia(page, api.projectKey, 'site.css');
    const toggle = drawer(page).getByRole('switch', { name: 'Process CMS syntax' });
    const enabled = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/process'));
    await toggle.check();
    expect((await enabled).status()).toBe(200);
    await expect(toggle).toBeChecked();
    await expect(drawer(page).locator('.drawer__title .cms-badge')).toBeVisible();
    await expect(drawer(page).locator('.process .diagnostic--error')).toHaveCount(0);

    // 3. Source tab: live validation flags $CMS_BODY and blocks Save; the diagnostic moves the caret.
    await drawer(page).getByRole('tab', { name: /Source/ }).click();
    const editor = drawer(page).getByRole('textbox', { name: 'File source' });
    await expect(editor).toHaveValue('h1 { color: $CMS_VALUE(global:site.brandColor)$; }\n');
    await editor.fill('h1 { color: $CMS_VALUE(global:site.brandColor)$; }\n$CMS_BODY(x)$\n');
    const error = drawer(page).locator('.source .diagnostic--error', { hasText: 'SF-TPL-0121' });
    await expect(error).toBeVisible({ timeout: 10_000 });
    await expect(drawer(page).getByRole('button', { name: 'Save' })).toBeDisabled();
    await error.click();
    const caret = await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart);
    expect(caret).toBe('h1 { color: $CMS_VALUE(global:site.brandColor)$; }\n'.length);
    await snap(page, 'j1-live-error');

    await editor.fill('h1 { color: $CMS_VALUE(global:site.brandColor)$; }\nbody { margin: 0; }\n');
    await expect(drawer(page).locator('.source .diagnostic--error')).toHaveCount(0, { timeout: 10_000 });
    const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/text'));
    await drawer(page).getByRole('button', { name: 'Save' }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(200);
    const savedRevision = (await savedResponse.json()).media.revision as number;
    expect((await api.revisions())[0].revisionId).toBe(savedRevision);
    await expect(
      page.locator('sf-revision-spine').getByRole('button', { name: new RegExp(`^Revision ${savedRevision} ·`) }),
    ).toBeVisible({ timeout: 10_000 });

    // 4. Rendered tab shows the substituted color.
    await drawer(page).getByRole('tab', { name: 'Rendered' }).click();
    await expect(drawer(page).locator('.rendered__output')).toContainText('h1 { color: #c00; }');
    await snap(page, 'j1-rendered');
    await drawer(page).getByRole('button', { name: 'Close' }).click();

    // 5. The page preview loads the rendered stylesheet.
    await navigate(page, `/p/${api.projectKey}/pages/${home.uuid}`);
    const heading = page.frameLocator('sf-page-editor sf-preview-frame iframe.preview-frame').locator('#t');
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => heading.evaluate((el) => getComputedStyle(el).color), { timeout: 15_000 })
      .toBe('rgb(204, 0, 0)');
    await snap(page, 'j1-preview');

    // 6. FULL generation writes the rendered stylesheet.
    const full = await api.generate('FULL', target.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');
    expect(builtFile(api.projectKey, target.id, full.id, 'assets/media/site_css.css')).toBe(
      'h1 { color: #c00; }\nbody { margin: 0; }\n',
    );
    expect(builtFile(api.projectKey, target.id, full.id, 'home.html')).toContain('href="assets/media/site_css.css"');

    // 7. Only the global changes: an INCREMENTAL run re-renders the stylesheet.
    await api.setValues(site.uuid, { brandColor: '#00c' });
    const incremental = await api.generate('INCREMENTAL', target.id);
    expect(incremental.status, JSON.stringify(incremental.diagnostics)).toBe('SUCCESS');
    expect(builtFile(api.projectKey, target.id, incremental.id, 'assets/media/site_css.css')).toContain('color: #00c;');
    expect(css.uuid).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('journey 2: time travel shows the old source read-only; closing with unsaved edits asks first', async ({ page }) => {
  const api = await Api.forNewProject('m18b');
  try {
    const css = await api.uploadText('site.css', 'text/css', 'a { color: red; }\n');
    const before = (await api.revisions())[0].revisionId as number;
    await api.put(`/media/${css.uuid}/text`, { text: 'a { color: blue; }\n' }, { 'If-Match': `"rev-${css.revision}"` });

    await login(page);
    await openMedia(page, api.projectKey, 'site.css');
    await drawer(page).getByRole('tab', { name: /Source/ }).click();
    const editor = drawer(page).getByRole('textbox', { name: 'File source' });
    await expect(editor).toHaveValue('a { color: blue; }\n');

    // Unsaved edits: dismissing the confirm keeps the drawer open, accepting it closes the drawer.
    await editor.fill('a { color: green; }\n');
    page.once('dialog', (dialog) => dialog.dismiss());
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(drawer(page).locator('aside.drawer')).toBeVisible();
    page.once('dialog', (dialog) => dialog.accept());
    await drawer(page).getByRole('button', { name: 'Close' }).click();
    await expect(drawer(page)).toHaveCount(0);

    // Time travel to the revision before the edit.
    await page
      .locator('sf-revision-spine')
      .getByRole('button', { name: new RegExp(`^Revision ${before} ·`) })
      .click();
    await expect(page.locator('.shell__timemachine')).toContainText(`Viewing revision ${before}`);
    await openMedia(page, api.projectKey, 'site.css');
    await expect(drawer(page).getByRole('switch', { name: 'Process CMS syntax' })).toBeDisabled();
    await drawer(page).getByRole('tab', { name: /Source/ }).click();
    await expect(editor).toHaveValue('a { color: red; }\n');
    await expect(editor).not.toBeEditable();
    await expect(drawer(page).getByRole('button', { name: 'Save' })).toBeDisabled();
    await snap(page, 'j2-time-travel');
  } finally {
    await api.dispose();
  }
});

test('journey 3: a robots.txt (detected as text/x-robots) can be processed and is published as .txt', async ({ page }) => {
  test.skip(!OUTPUT_ROOT, 'reads generated files: set SF_E2E_OUTPUT_ROOT');
  const api = await Api.forNewProject('m18c');
  try {
    // Tika reads the content: a file starting with "User-agent:" is text/x-robots, not text/plain.
    await api.globalSet('Site', SITE_CDL, { brandColor: 'https://example.com' });
    const robots = await api.uploadText('robots.txt', 'text/plain', 'User-agent: *\nSitemap: $CMS_VALUE(global:site.brandColor)$/sitemap.xml\n');
    expect(robots.mimeType).toBe('text/x-robots');
    expect(robots.textEditable).toBe(true);
    const tpl = await api.pageTemplate('Links robots', '<html><body><a id="r" href="$CMS_REF(media:robots_txt)$">robots</a></body></html>');
    await api.page('Home', tpl.uuid);
    const target = await api.target();

    await login(page);
    await openMedia(page, api.projectKey, 'robots.txt');
    const toggle = drawer(page).getByRole('switch', { name: 'Process CMS syntax' });
    await expect(toggle).toBeVisible();
    const enabled = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/process'));
    await toggle.check();
    expect((await enabled).status()).toBe(200);
    await expect(drawer(page).locator('.drawer__title .cms-badge')).toBeVisible();
    await snap(page, 'j3-robots-processed');

    const full = await api.generate('FULL', target.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');
    expect(builtFile(api.projectKey, target.id, full.id, 'assets/media/robots_txt.txt')).toBe(
      'User-agent: *\nSitemap: https://example.com/sitemap.xml\n',
    );
    expect(builtFile(api.projectKey, target.id, full.id, 'home.html')).toContain('href="assets/media/robots_txt.txt"');
  } finally {
    await api.dispose();
  }
});
