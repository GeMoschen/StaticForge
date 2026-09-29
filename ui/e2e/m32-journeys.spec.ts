import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * M32 complete URL registry journey (`M32.8`):
 *   1. seed (REST): a project with a target, a page "About" and a page "Home" linking it;
 *   2. a FULL run registers both pages' URLs;
 *   3. Settings → URLs lists them; the About URL is overridden in the table (a refused URL shows the server's reason);
 *   4. an INCREMENTAL run writes About at its new URL, and Home's link follows it;
 *   5. the page editor's URLs section of About shows the manual URL.
 *
 * Prerequisites (as for the M16–M31 journeys):
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev SF_OUTPUT_ROOT=<dir> ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<same dir as SF_OUTPUT_ROOT> npx playwright test e2e/m32-journeys.spec.ts`.
 *     Without `SF_E2E_OUTPUT_ROOT` the file checks of step 4 are skipped.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';
const OUTPUT_ROOT = process.env['SF_E2E_OUTPUT_ROOT'];

test.use({ baseURL: BASE_URL });

type Json = Record<string, any>;

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
    await api.post('/api/v1/projects', { key, name: `M32 ${prefix}` });
    return api;
  }

  private url(p: string): string {
    return p.startsWith('/api') ? p : `/api/v1/projects/${this.projectKey}${p}`;
  }

  async post(p: string, data: unknown): Promise<Json> {
    const res = await this.ctx.post(this.url(p), { data });
    expect(res.ok(), `POST ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.status() === 204 ? {} : res.json();
  }

  async get(p: string): Promise<any> {
    const res = await this.ctx.get(this.url(p));
    expect(res.ok(), `GET ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  /** Releases pages (with the templates' and folders' dependencies) so the next build renders them. */
  async release(uuids: string[]): Promise<void> {
    const items = uuids.map((assetUuid) => ({ assetUuid }));
    const plan = await this.post('/releases/plan', { items });
    const includeDependencies = (plan.dependencies ?? [])
      .filter((d: Json) => d.includedByDefault)
      .map((d: Json) => ({ assetUuid: d.target.uuid, locale: d.target.locale }));
    await this.post('/releases', { items, includeDependencies });
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

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey: a page keeps its URL until it is overridden, and the next build moves it', async ({ page }) => {
  test.setTimeout(240_000);
  const api = await Api.forNewProject('m32a');
  try {
    // 1. Seed.
    const site = await api.post('/targets', {
      name: 'Site',
      type: 'FILESYSTEM',
      config: { baseUrl: 'https://example.com' },
      isDefault: true,
    });
    const plain = await api.post('/page-templates', {
      displayName: 'Plain',
      contentDefinition: '',
      channelSources: { html: '<p>plain</p>' },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const about = await api.post('/pages', { displayName: 'About', templateUuid: plain.uuid });
    const linker = await api.post('/page-templates', {
      displayName: 'Linker',
      contentDefinition: '',
      channelSources: { html: `<a id="about" href="$CMS_REF(page:${about.uid})$">about</a>` },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const home = await api.post('/pages', { displayName: 'Home', templateUuid: linker.uuid });
    await api.release([about.uuid, home.uuid]);

    // 2. The first build registers both URLs.
    const full = await api.generate('FULL', site.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');

    // 3. Settings → URLs: the rows, a refused override, then an accepted one.
    await login(page);
    await navigate(page, `/p/${api.projectKey}/settings/url-registry`);
    const panel = page.locator('sf-project-settings-url-registry');
    const aboutRow = panel.locator('tr', { hasText: 'about.html' });
    await expect(aboutRow).toContainText('About');
    await expect(panel.locator('tr', { hasText: 'home.html' })).toContainText('Page');
    await snap(page, '01-urls-panel');

    await aboutRow.getByRole('button', { name: 'Override' }).click();
    const input = panel.locator('input.url-input');
    await input.fill('home.html');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByRole('alert')).toContainText('already the URL of');
    await input.fill('company/about.html');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.locator('tr', { hasText: 'company/about.html' })).toContainText('overridden');
    await snap(page, '02-overridden');

    // 4. The next incremental build moves About and re-renders Home.
    const incremental = await api.generate('INCREMENTAL', site.id);
    expect(incremental.status, JSON.stringify(incremental.diagnostics)).toBe('SUCCESS');
    if (OUTPUT_ROOT) {
      const build = path.join(OUTPUT_ROOT, api.projectKey, `target-${site.id}`, 'builds', String(incremental.id));
      expect(fs.readFileSync(path.join(build, 'company', 'about.html'), 'utf8')).toContain('plain');
      expect(fs.readFileSync(path.join(build, 'home.html'), 'utf8')).toContain('href="company/about.html"');
    }

    // 5. The page editor shows the manual URL in its URLs section.
    await navigate(page, `/p/${api.projectKey}/pages/${about.uuid}`);
    const urls = page.locator('sf-asset-urls');
    await expect(urls).toContainText('company/about.html');
    await expect(urls).toContainText('manual');
    await snap(page, '03-page-editor-urls');
  } finally {
    await api.dispose();
  }
});
