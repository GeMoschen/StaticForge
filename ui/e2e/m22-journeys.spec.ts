import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cdl } from './cdl';

/**
 * M22 build insight journey (feature `docs-e2e`, `M22.5.1`) — "why is this rebuilding?":
 *   1. seed (REST): a project with a target, an `Article` page template placing sections, a section template `teaser`
 *      on 3 of 5 pages, and a media file `hero.txt` that 1 page references;
 *   2. a FULL run (the baseline);
 *   3. `teaser` changes; in the generation dialog an INCREMENTAL preview (Alt+P) shows 3 files, each chain
 *      `page ← section_template:teaser`;
 *   4. the run started from the dialog lists the same entries in its "Rebuilt pages" tab;
 *   5. the published build holds all 5 pages and the sitemap lists all 5 (the M22.4.1 regression check);
 *   6. the media drawer's Impact panel asks nothing until opened, then shows 1 page reached over "references media";
 *   7. a preview for a second target without builds warns that incremental falls back to a full build.
 *
 * Prerequisites (as for the M16–M21 journeys):
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev SF_OUTPUT_ROOT=<dir> ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<same dir as SF_OUTPUT_ROOT> npx playwright test e2e/m22-journeys.spec.ts`.
 *     Without `SF_E2E_OUTPUT_ROOT` step 5 is skipped.
 *
 * The access token is memory-only: after the login every navigation goes through the router.
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
    await api.post('/api/v1/projects', { key, name: `M22 ${prefix}` });
    return api;
  }

  private url(p: string): string {
    return p.startsWith('/api') ? p : `/api/v1/projects/${this.projectKey}${p}`;
  }

  async post(p: string, data: unknown, headers?: Record<string, string>): Promise<Json> {
    const res = await this.ctx.post(this.url(p), { data, headers });
    expect(res.ok(), `POST ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async get(p: string): Promise<any> {
    const res = await this.ctx.get(this.url(p));
    expect(res.ok(), `GET ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async uploadText(fileName: string, text: string): Promise<Json> {
    const res = await this.ctx.post(this.url('/media'), {
      multipart: { file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') } },
    });
    expect(res.ok(), `upload → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async saveChannelSource(kind: 'section-templates' | 'page-templates', uuid: string, source: string): Promise<Json> {
    const current = await this.get(`/${kind}/${uuid}`);
    const res = await this.ctx.put(this.url(`/${kind}/${uuid}/channels/html`), {
      data: { source },
      headers: { 'If-Match': `"rev-${current.revision}"` },
    });
    expect(res.ok(), `save channel → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async addSection(pageUuid: string, templateUuid: string): Promise<Json> {
    const current = await this.get(`/pages/${pageUuid}`);
    return this.post(`/pages/${pageUuid}/bodies/main/sections`, { templateUuid }, { 'If-Match': `"rev-${current.revision}"` });
  }

  async patchContent(pageUuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/pages/${pageUuid}`);
    const res = await this.ctx.patch(this.url(`/pages/${pageUuid}/content`), {
      data: { content },
      headers: { 'If-Match': `"rev-${current.revision}"`, 'Content-Type': 'application/merge-patch+json' },
    });
    expect(res.ok(), `patch content → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async generate(mode: 'FULL' | 'INCREMENTAL', targetId: number): Promise<Json> {
    const started = await this.post('/generations', { mode, channels: ['html'], targetId });
    return this.awaitRun(started.id);
  }

  async awaitRun(runId: number): Promise<Json> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const run = await this.get(`/generations/${runId}`);
      if (['SUCCESS', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.status)) {
        return run;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`generation ${runId} did not finish within 60s`);
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

test('journey: why is this rebuilding?', async ({ page }) => {
  test.setTimeout(240_000);
  const api = await Api.forNewProject('m22a');
  try {
    // 1. Seed.
    const site = await api.post('/targets', {
      name: 'Site',
      type: 'FILESYSTEM',
      config: { baseUrl: 'https://example.com' },
      isDefault: true,
    });
    const staging = await api.post('/targets', { name: 'Staging', type: 'FILESYSTEM', config: {}, isDefault: false });
    const hero = await api.uploadText('hero.txt', 'HERO');
    const teaser = await api.post('/section-templates', {
      displayName: 'Teaser',
      ...cdl(''),
      channelSources: { html: '<p>teaser v1</p>' },
    });
    const article = await api.post('/page-templates', {
      displayName: 'Article',
      ...cdl('bodies { body main { label "Main" allow ["*"] } }'),
      channelSources: { html: '<main>$CMS_BODY(main)$</main>' },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const withHero = await api.post('/page-templates', {
      displayName: 'With hero',
      ...cdl('content { editor media hero { label "Hero" } }'),
      channelSources: { html: '<img src="$CMS_REF(hero)$">' },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const pages: Json[] = [];
    for (const name of ['One', 'Two', 'Three']) {
      const created = await api.post('/pages', { displayName: name, templateUuid: article.uuid });
      await api.addSection(created.uuid, teaser.uuid);
      pages.push(created);
    }
    const about = await api.post('/pages', { displayName: 'About', templateUuid: withHero.uuid });
    await api.patchContent(about.uuid, { hero: { type: 'MEDIA_REF', uuid: hero.uuid } });
    await api.post('/pages', { displayName: 'Legal', templateUuid: article.uuid });

    // 2. The baseline.
    const full = await api.generate('FULL', site.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');

    // 3. The teaser changes; the dialog previews an incremental build.
    await api.saveChannelSource('section-templates', teaser.uuid, '<p>teaser v2</p>');
    await login(page);
    await navigate(page, `/p/${api.projectKey}/settings/generation`);
    const screen = page.locator('sf-generation');
    await screen.getByRole('button', { name: 'New generation', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New generation' });
    await dialog.locator('input[type="radio"][value="INCREMENTAL"]').check();
    await dialog.locator('select.select').selectOption({ label: 'Site' });
    await dialog.locator('input[type="radio"][value="INCREMENTAL"]').focus();
    await page.keyboard.press('Alt+p');
    const preview = dialog.locator('.preview__result');
    await expect(preview.locator('.preview__counts')).toContainText('3 files to rebuild', { timeout: 20_000 });
    await expect(preview.locator('.preview__warning')).toHaveCount(0);
    await expect(preview.locator('.preview__via')).toContainText('3 via section_template:teaser');
    const rows = preview.locator('sf-plan-entries-table tbody tr:not(.entries__detail)');
    await expect(rows).toHaveCount(3);
    await expect(rows.locator('td.entries__path')).toHaveText(['one.html', 'three.html', 'two.html']);
    const firstReason = rows.first().getByRole('button', { name: /Changed/ });
    await firstReason.focus();
    await page.keyboard.press('Enter');
    await expect(firstReason).toHaveAttribute('aria-expanded', 'true');
    const chain = preview.getByRole('list', { name: /Why this is rebuilt/ });
    await expect(chain.locator('li')).toHaveCount(2);
    await expect(chain.locator('li').first()).toContainText('page:one');
    await expect(chain.locator('li').first()).toContainText('places section');
    await expect(chain.locator('li').last()).toContainText('section_template:teaser');
    await snap(page, 'j3-plan-preview');

    // Changing the mode marks the preview stale.
    await dialog.locator('input[type="radio"][value="FULL"]').check();
    await expect(preview.locator('.preview__stale')).toBeVisible();
    await dialog.locator('input[type="radio"][value="INCREMENTAL"]').check();
    await expect(preview.locator('.preview__stale')).toHaveCount(0);

    // 4. Start it; the run's "Rebuilt pages" tab lists the same entries.
    const started = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/generations'));
    await dialog.getByRole('button', { name: 'Start', exact: true }).click();
    const run = await api.awaitRun((await (await started).json()).id);
    expect(run.status, JSON.stringify(run.diagnostics)).toBe('SUCCESS');
    expect(run.planSummary.entryCount).toBe(3);
    await navigate(page, `/p/${api.projectKey}/settings/pages`);
    await navigate(page, `/p/${api.projectKey}/settings/generation`);
    const runRow = screen.locator('tbody tr', { hasText: `#${run.id}` });
    await expect(runRow).toContainText('Incremental · 3 pages (via 1 change)', { timeout: 15_000 });
    await runRow.getByRole('button', { name: 'Details' }).click();
    await screen.getByRole('tab', { name: 'Rebuilt pages' }).click();
    const runEntries = screen.locator('.details-row sf-plan-entries-table tbody tr:not(.entries__detail)');
    await expect(runEntries.locator('td.entries__path')).toHaveText(['one.html', 'three.html', 'two.html']);
    await snap(page, 'j4-rebuilt-pages');

    // 5. The published site is complete.
    if (OUTPUT_ROOT) {
      const dir = path.join(OUTPUT_ROOT, api.projectKey, `target-${site.id}`, 'builds', String(run.id));
      for (const file of ['one.html', 'two.html', 'three.html', 'about.html', 'legal.html', 'assets/media/hero_txt.txt']) {
        expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
      }
      expect(fs.readFileSync(path.join(dir, 'one.html'), 'utf8')).toContain('teaser v2');
      const sitemap = fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8');
      for (const file of ['one.html', 'two.html', 'three.html', 'about.html', 'legal.html']) {
        expect(sitemap).toContain(`https://example.com/${file}`);
      }
    }

    // 6. The media drawer: no impact request until the panel opens.
    const impactRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/impact')) {
        impactRequests.push(request.url());
      }
    });
    await navigate(page, `/p/${api.projectKey}/media`);
    await page.locator('sf-media-library .cell__body', { hasText: 'hero.txt' }).click();
    const drawer = page.locator('sf-media-detail-drawer');
    await expect(drawer.locator('.drawer__title')).toContainText('hero.txt');
    const impactToggle = drawer.getByRole('button', { name: /Impact/ });
    await expect(impactToggle).toHaveAttribute('aria-expanded', 'false');
    await page.waitForTimeout(500);
    expect(impactRequests).toEqual([]);
    await impactToggle.click();
    await expect(drawer.locator('.impact__headline')).toHaveText('Changing this rebuilds 1 page (1 file)', { timeout: 15_000 });
    expect(impactRequests).toHaveLength(1);
    await drawer.locator('sf-plan-entries-table').getByRole('button', { name: /Show chain/ }).click();
    await expect(drawer.getByRole('list', { name: /Why this is rebuilt/ }).locator('li').first()).toContainText(
      'references media',
    );
    await snap(page, 'j6-media-impact');
    await drawer.getByRole('button', { name: 'Close' }).first().click().catch(() => undefined);

    // The template editor and the page editor carry the same panel.
    await navigate(page, `/p/${api.projectKey}/templates`);
    const templates = page.locator('sf-templates');
    await templates.getByRole('treeitem', { name: /Section Templates/ }).first().click();
    await templates.getByRole('treeitem', { name: /Teaser/ }).first().click();
    await expect(templates.locator('.detail__head h3')).toHaveText('Teaser', { timeout: 15_000 });
    await templates.locator('sf-asset-impact').getByRole('button', { name: /Impact/ }).click();
    await expect(templates.locator('.impact__headline')).toHaveText('Changing this rebuilds 3 pages (3 files)', {
      timeout: 15_000,
    });
    await snap(page, 'j6-template-impact');
    await navigate(page, `/p/${api.projectKey}/pages/${about.uuid}`);
    const editor = page.locator('sf-page-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await editor.locator('sf-asset-impact').getByRole('button', { name: /Impact/ }).click();
    await expect(editor.locator('.impact__headline')).toHaveText('Changing this rebuilds 1 page (1 file)', {
      timeout: 15_000,
    });
    await expect(editor.locator('sf-asset-impact .impact__toggle')).toBeInViewport();
    await snap(page, 'j6-page-impact');

    // 7. A target without builds: the preview warns about the fallback.
    await navigate(page, `/p/${api.projectKey}/settings/generation`);
    await screen.getByRole('button', { name: 'New generation', exact: true }).click();
    await dialog.locator('input[type="radio"][value="INCREMENTAL"]').check();
    await dialog.locator('select.select').selectOption({ label: 'Staging' });
    await dialog.getByRole('button', { name: 'Preview plan' }).click();
    await expect(dialog.locator('.preview__warning')).toHaveText(
      'Incremental requested — no previous complete build for target Staging; this will be a full build.',
      { timeout: 20_000 },
    );
    await expect(dialog.locator('.preview__counts')).toContainText('5 files to rebuild');
    await snap(page, 'j7-fallback-warning');
    expect(staging.id).toBeGreaterThan(0);
  } finally {
    await api.dispose();
  }
});
