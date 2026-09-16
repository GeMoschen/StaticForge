import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * M16 foundations regression journeys (feature `e2e-verification`, `M16.6.1`):
 *   1. cross-asset value — `$CMS_VALUE(page:b.headline)$` in preview, live edit, INCREMENTAL rebuild;
 *   2. usages + delete guard — usages right after save (no generation), delete without force after removal;
 *   3. channel settings — PRETTY + trailing slash through the channels UI, `about/index.html`, link check;
 *   4. include cycle — preview shows `SF-TPL-0135`, generation reports it for that page only;
 *   5. validation split — empty required editor autosaves, generation holds the page back (`SF-GEN-0120`, PARTIAL).
 *
 * Unlike the m3–m15 journeys this file is **self-seeding**: every journey creates its own
 * project, templates, pages, media, navigation and target through the REST API, so it only
 * needs a running backend with an instance admin — no demo seed.
 *
 * Prerequisites:
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev SF_OUTPUT_ROOT=<dir> ./gradlew :server:sf-app:bootRun` (port 8081,
 *     seeded instance admin `Admin` / `Admin`).
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<same dir as SF_OUTPUT_ROOT> npx playwright test e2e/m16-journeys.spec.ts`.
 *     Journeys 1, 3 and 4 read the generated files, so they need `SF_E2E_OUTPUT_ROOT`.
 *
 * The access token is memory-only: `page.goto` to a deep link drops the session, so after the
 * login every navigation goes through the router (`history.pushState` + `popstate`).
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';
const OUTPUT_ROOT = process.env['SF_E2E_OUTPUT_ROOT'];

test.use({ baseURL: BASE_URL });

/** 1×1 transparent PNG. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ---------------------------------------------------------------------------------------------
// API seeding
// ---------------------------------------------------------------------------------------------

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
    await api.post('/api/v1/projects', { key, name: `M16 ${prefix}` });
    return api;
  }

  private url(p: string): string {
    return `/api/v1/projects/${this.projectKey}${p}`;
  }

  async post(p: string, data: unknown, headers?: Record<string, string>): Promise<Json> {
    const res = await this.ctx.post(p.startsWith('/api') ? p : this.url(p), { data, headers });
    expect(res.ok(), `POST ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async get(p: string): Promise<any> {
    const res = await this.ctx.get(this.url(p));
    expect(res.ok(), `GET ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  raw(): APIRequestContext {
    return this.ctx;
  }

  rawUrl(p: string): string {
    return this.url(p);
  }

  pageTemplate(displayName: string, source: string, cdl = ''): Promise<Json> {
    return this.post('/page-templates', { displayName, contentDefinition: cdl, channelSources: { html: source } });
  }

  sectionTemplate(displayName: string, source: string): Promise<Json> {
    return this.post('/section-templates', { displayName, contentDefinition: '', channelSources: { html: source } });
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

  page(displayName: string, templateUuid: string, folderUuid?: string): Promise<Json> {
    return this.post('/pages', { displayName, templateUuid, folderUuid });
  }

  /** JSON merge patch of the page payload's `content` (what the editor's autosave sends). */
  async patchContent(pageUuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/pages/${pageUuid}`);
    const res = await this.ctx.patch(this.url(`/pages/${pageUuid}/content`), {
      data: { content },
      headers: { 'If-Match': `"rev-${current.revision}"`, 'Content-Type': 'application/merge-patch+json' },
    });
    expect(res.ok(), `patch content → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  folder(displayName: string, scope: 'PAGES' | 'NAVIGATION', parentFolderUuid?: string): Promise<Json> {
    return this.post('/folders', { displayName, scope, parentFolderUuid });
  }

  pageReference(displayName: string, folderUuid: string, targetAssetUuid: string, label: string): Promise<Json> {
    return this.post('/navigation/references', { displayName, folderUuid, targetKind: 'PAGE', targetAssetUuid, label });
  }

  async uploadMedia(fileName: string): Promise<Json> {
    const res = await this.ctx.post(this.url('/media'), {
      multipart: { file: { name: fileName, mimeType: 'image/png', buffer: PNG_1X1 }, altText: 'Logo' },
    });
    expect(res.ok(), `upload → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
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

// ---------------------------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------------------------

function buildDir(projectKey: string, targetId: number, runId: number): string {
  return path.join(OUTPUT_ROOT!, projectKey, `target-${targetId}`, 'builds', String(runId));
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        out.push(path.relative(dir, full).split(path.sep).join('/'));
      }
    }
  };
  walk(dir);
  return out.sort();
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

/**
 * `tasks/lessons.md`: generated links are relative to the current page. Resolves every relative
 * href of every html page against that page's own directory; a directory href must contain the
 * channel's index file. Returns the broken `page -> href` pairs and how many links were checked.
 */
function checkLinks(dir: string, indexFileName: string): { checked: number; broken: string[] } {
  const broken: string[] = [];
  let checked = 0;
  for (const file of listFiles(dir).filter((f) => f.endsWith('.html'))) {
    const pageDir = path.dirname(path.join(dir, file));
    for (const href of hrefs(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      if (href.startsWith('/') || href.includes(':') || href.startsWith('#')) {
        continue;
      }
      checked++;
      let target = path.resolve(pageDir, href);
      if (href === '' || href.endsWith('/')) {
        target = path.join(target, indexFileName);
      }
      const inside = path.relative(dir, target);
      if (inside.startsWith('..') || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        broken.push(`${file} -> ${href}`);
      }
    }
  }
  return { checked, broken };
}

// ---------------------------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------------------------

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

/** Evidence screenshot in the test's output directory (`--output`). */
async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
}

function requireOutputRoot(): void {
  test.skip(!OUTPUT_ROOT, 'reads generated files: set SF_E2E_OUTPUT_ROOT to the backend SF_OUTPUT_ROOT');
}

// ---------------------------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------------------------

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey 1: cross-asset value renders in preview, follows edits and rebuilds incrementally', async ({ page }) => {
  requireOutputRoot();
  const api = await Api.forNewProject('m16a');
  try {
    const headlineTpl = await api.pageTemplate('Headline', '<h1>$CMS_VALUE(headline)$</h1>', 'content {\n  editor text headline { }\n}');
    const pageB = await api.page('pageb', headlineTpl.uuid);
    await api.patchContent(pageB.uuid, { headline: 'Hello from B' });
    const readerTpl = await api.pageTemplate('Reader', `<p id="x">A sees [$CMS_VALUE(page:${pageB.uid}.headline)$]</p>`);
    const pageA = await api.page('pagea', readerTpl.uuid);
    const pageC = await api.page('pagec', headlineTpl.uuid);
    await api.patchContent(pageC.uuid, { headline: 'Unrelated C' });
    const target = await api.target();
    const full = await api.generate('FULL', target.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');
    expect(fs.readFileSync(path.join(buildDir(api.projectKey, target.id, full.id), 'pagea.html'), 'utf8'))
      .toContain('A sees [Hello from B]');

    // Preview A in the page editor.
    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages/${pageA.uuid}`);
    await expect(page.locator('sf-page-editor')).toBeVisible();
    await expect(previewBody(page)).toContainText('A sees [Hello from B]', { timeout: 15_000 });

    // Edit B, preview A again.
    await api.patchContent(pageB.uuid, { headline: 'B was edited' });
    await page.locator('sf-page-editor sf-preview-frame').getByRole('button', { name: 'Refresh' }).click();
    await expect(previewBody(page)).toContainText('A sees [B was edited]', { timeout: 15_000 });
    await snap(page, 'j1-preview-after-edit');

    // INCREMENTAL: A is rebuilt through its OCTL_VALUE edge to B; C is untouched.
    const incremental = await api.generate('INCREMENTAL', target.id);
    expect(incremental.status, JSON.stringify(incremental.diagnostics)).toBe('SUCCESS');
    const dir = buildDir(api.projectKey, target.id, incremental.id);
    expect(fs.readFileSync(path.join(dir, 'pagea.html'), 'utf8')).toContain('A sees [B was edited]');
    expect(fs.readFileSync(path.join(dir, 'pageb.html'), 'utf8')).toContain('B was edited');
    expect(incremental.filesWritten).toBeLessThan(full.filesWritten);
  } finally {
    await api.dispose();
  }
});

test('journey 2: media usages appear on save and the delete guard lifts once the reference is removed', async ({ page }) => {
  const api = await Api.forNewProject('m16b');
  try {
    const media = await api.uploadMedia('logo.png');
    const tpl = await api.pageTemplate('Hero', '<img src="$CMS_REF(hero)$">', 'content {\n  editor media hero { }\n}');
    const hero = await api.page('heropage', tpl.uuid);
    await api.patchContent(hero.uuid, { hero: { type: 'MEDIA_REF', uuid: media.uuid } });

    // No generation ever ran in this project.
    expect(await api.get('/generations')).toHaveLength(0);

    // The delete guard blocks a plain delete while the page references the media.
    const blocked = await api.raw().delete(api.rawUrl(`/assets/${media.uuid}`));
    expect(blocked.status(), await blocked.text()).toBe(409);

    await login(page);
    await navigate(page, `/p/${api.projectKey}/media`);
    await expect(page.locator('sf-media-library')).toBeVisible();
    await page.locator('sf-media-library .cell__body').filter({ hasText: 'logo' }).click();
    const drawer = page.locator('sf-media-detail-drawer');
    await expect(drawer.locator('.usages')).toContainText(hero.uid);
    await expect(drawer.locator('.usages')).toContainText('PAGE');
    await snap(page, 'j2-usages-without-generation');
    await drawer.getByRole('button', { name: 'Close' }).click();

    // Remove the reference from the page; the drawer now shows no usages and deletes without force.
    await api.patchContent(hero.uuid, { hero: null });
    await page.locator('sf-media-library .cell__body').filter({ hasText: 'logo' }).click();
    await expect(drawer.getByText('Not referenced by any asset.')).toBeVisible();
    await snap(page, 'j2-no-usages-after-removal');
    const deleteRequest = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().includes(`/assets/${media.uuid}`));
    const deleteResponse = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes(`/assets/${media.uuid}`));
    await drawer.getByRole('button', { name: 'Delete' }).click();
    await page.locator('.dlg').getByRole('button', { name: 'Delete' }).click();
    expect((await deleteRequest).url()).not.toContain('force=true');
    expect((await deleteResponse).status()).toBeLessThan(300);
    await expect(page.locator('sf-media-library .cell__body').filter({ hasText: 'logo' })).toHaveCount(0);
    expect((await api.get('/media')).content ?? []).toHaveLength(0);
  } finally {
    await api.dispose();
  }
});

test('journey 3: PRETTY + trailing slash channel writes directory pages whose links all resolve', async ({ page }) => {
  requireOutputRoot();
  const api = await Api.forNewProject('m16c');
  try {
    const plain = await api.pageTemplate('Plain', '<p>content</p>');
    const pf = await api.folder('pf', 'PAGES');
    const about = await api.page('about', plain.uuid);
    const p2 = await api.page('p2', plain.uuid, pf.uuid);
    const nav = await api.folder('Main Nav', 'NAVIGATION');
    const linker = await api.pageTemplate(
      'Linker',
      `<nav>$CMS_NAVIGATION(nav:${nav.uid})$</nav><a href="$CMS_REF(page:${about.uid})$">about</a><a href="$CMS_REF(page:${p2.uid})$">p2</a>`,
    );
    const home = await api.page('home', linker.uuid);
    await api.page('deep', linker.uuid, pf.uuid);
    await api.pageReference('home-ref', nav.uuid, home.uuid, 'Home');
    await api.pageReference('about-ref', nav.uuid, about.uuid, 'About');
    await api.pageReference('p2-ref', nav.uuid, p2.uuid, 'P2');
    const target = await api.target();

    // Channel settings through the channels UI.
    await login(page);
    await navigate(page, `/p/${api.projectKey}/settings/channels`);
    const channels = page.locator('sf-channels');
    await channels.locator('tr', { hasText: 'html' }).getByRole('button', { name: 'Edit' }).click();
    await channels.locator('select[formControlName="urlStrategy"]').selectOption('PRETTY');
    await channels.locator('input[formControlName="trailingSlash"]').check();
    await channels.locator('input[formControlName="indexUid"]').fill('home');
    await snap(page, 'j3-channel-form');
    await channels.getByRole('button', { name: 'Save changes' }).click();
    await expect(channels.getByRole('button', { name: 'Save changes' })).toBeHidden();
    const html = (await api.get('/channels')).find((c: Json) => c.key === 'html');
    expect(html.settings).toMatchObject({ urlStrategy: 'PRETTY', trailingSlash: true, indexUid: 'home' });

    const run = await api.generate('FULL', target.id);
    expect(run.status, JSON.stringify(run.diagnostics)).toBe('SUCCESS');
    const dir = buildDir(api.projectKey, target.id, run.id);
    const pages = listFiles(dir).filter((f) => f.endsWith('.html'));
    expect(pages).toEqual(['about/index.html', 'index.html', 'pf/deep/index.html', 'pf/p2/index.html']);
    const rootHrefs = hrefs(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
    expect(rootHrefs).toEqual(expect.arrayContaining(['./', 'about/', 'pf/p2/']));
    const deepHrefs = hrefs(fs.readFileSync(path.join(dir, 'pf/deep/index.html'), 'utf8'));
    expect(deepHrefs).toEqual(expect.arrayContaining(['../../', '../../about/', '../p2/']));

    const { checked, broken } = checkLinks(dir, 'index.html');
    expect(checked).toBeGreaterThanOrEqual(10);
    expect(broken).toEqual([]);
  } finally {
    await api.dispose();
  }
});

test('journey 4: an include cycle shows SF-TPL-0135 in preview and fails only that page in generation', async ({ page }) => {
  requireOutputRoot();
  const api = await Api.forNewProject('m16d');
  try {
    // A cycle cannot be saved in one step (each include must resolve on save).
    const a = await api.sectionTemplate('Cycle A', 'A');
    const b = await api.sectionTemplate('Cycle B', `B[$CMS_INCLUDE(section_template:${a.uid})$]`);
    await api.saveChannelSource('section-templates', a.uuid, `A[$CMS_INCLUDE(section_template:${b.uid})$]`);
    const cycleTpl = await api.pageTemplate('Cycle Page', `<main>$CMS_INCLUDE(section_template:${a.uid})$</main>`);
    const plain = await api.pageTemplate('Plain', '<p>fine</p>');
    const cyclic = await api.page('cyclic', cycleTpl.uuid);
    await api.page('healthy', plain.uuid);
    const target = await api.target();

    // Preview.
    const direct = await api.raw().get(api.rawUrl(`/preview/pages/${cyclic.uuid}`));
    expect(direct.status()).toBe(422);
    expect((await direct.json()).code).toBe('SF-TPL-0135');

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages/${cyclic.uuid}`);
    await expect(page.locator('sf-page-editor')).toBeVisible();
    await expect(previewBody(page)).toContainText('SF-TPL-0135', { timeout: 15_000 });
    await expect(previewBody(page)).toContainText(`${a.uid} → ${b.uid} → ${a.uid}`);
    await snap(page, 'j4-preview-include-cycle');

    // Generation: the diagnostic names the cyclic page only; the healthy page is still rendered.
    const run = await api.generate('FULL', target.id);
    expect(run.status, JSON.stringify(run.diagnostics)).toBe('PARTIAL');
    expect(run.diagnostics.errors).toEqual([
      {
        code: 'SF-TPL-0135',
        count: 1,
        messages: [`Page '${cyclic.uid}' (html): Include cycle: ${a.uid} → ${b.uid} → ${a.uid}`],
      },
    ]);
    const files = listFiles(buildDir(api.projectKey, target.id, run.id));
    expect(files).toContain('healthy.html');
    expect(files).not.toContain('cyclic.html');
  } finally {
    await api.dispose();
  }
});

test('journey 5: an empty required editor autosaves but holds the page back with SF-GEN-0120 (PARTIAL)', async ({ page }) => {
  const api = await Api.forNewProject('m16e');
  try {
    const tpl = await api.pageTemplate(
      'Article',
      '<h1>$CMS_VALUE(title)$</h1><p>$CMS_VALUE(subtitle)$</p>',
      'content {\n  editor text title { label "Title" required }\n  editor text subtitle { label "Subtitle" }\n}',
    );
    const incomplete = await api.page('incomplete', tpl.uuid);
    const complete = await api.page('complete', tpl.uuid);
    await api.patchContent(complete.uuid, { title: 'Done', subtitle: 'ok' });
    const target = await api.target();

    // Autosave through the editor while the required title stays empty.
    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages/${incomplete.uuid}`);
    const editor = page.locator('sf-page-editor');
    await expect(editor).toBeVisible();
    const saveResponse = page.waitForResponse(
      (r) => r.url().includes(`/pages/${incomplete.uuid}`) && ['PUT', 'PATCH'].includes(r.request().method()),
      { timeout: 20_000 },
    );
    await editor.locator('sf-text-editor', { hasText: 'Subtitle' }).locator('input').fill('only the subtitle');
    const saved = await saveResponse;
    expect(saved.status(), await saved.text()).toBe(200);
    const body = await saved.json();
    expect(body.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'content.title', code: 'required', kind: 'COMPLETENESS' })]),
    );
    await expect(editor.locator('.page-editor__status')).toContainText('Saved');
    await snap(page, 'j5-autosaved-with-empty-required');
    expect((await api.get(`/pages/${incomplete.uuid}`)).content.subtitle).toBe('only the subtitle');

    // Generation: PARTIAL, one SF-GEN-0120 for the incomplete page, the complete page is published.
    const run = await api.generate('FULL', target.id);
    expect(run.status, JSON.stringify(run.diagnostics)).toBe('PARTIAL');
    const errors: Json[] = run.diagnostics?.errors ?? [];
    expect(errors.map((e) => e.code)).toEqual(['SF-GEN-0120']);
    expect(JSON.stringify(errors[0])).toContain('content.title');
    if (OUTPUT_ROOT) {
      const files = listFiles(buildDir(api.projectKey, target.id, run.id));
      expect(files).toContain('complete.html');
      expect(files).not.toContain('incomplete.html');
    }
  } finally {
    await api.dispose();
  }
});
