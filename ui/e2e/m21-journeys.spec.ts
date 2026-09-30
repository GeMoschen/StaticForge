import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cdl } from './cdl';

/**
 * M21 pagination journey (feature `docs-e2e`, `M21.5.1`) — "one page, N listing pages":
 *   1. a developer creates a page template with `editor pagination posts { sources ["nav"] pageSize 2 sort ["navigation"] }`
 *      and an html channel with an items loop and prev/next links, in the Templates store, and sets the html pagination
 *      path `{pagePath}/page-{pageNumber}.{ext}` (a pattern without `{pageNumber}` is flagged first);
 *   2. five posts and a navigation folder with five page references (seeded through the API);
 *   3. an editor creates a blog page from the template, sets page size 2 and picks the folder in the source picker; the
 *      field shows "5 items → 3 pages";
 *   4. the preview shows "Page 1 of 3"; the selector and a pagination link inside the preview switch pages; page 3
 *      shows one item; at 1280 px the editor column, the page selector and Refresh are all on screen;
 *   5. FULL generation writes blog.html, blog/page-2.html, blog/page-3.html, and every href resolves against its own page;
 *   6. a page reference is removed and INCREMENTAL generation publishes two pages, with no blog/page-3.html.
 *
 * Self-seeding like the M16–M20 journeys: it creates its own project through the REST API and only needs a running
 * dev backend with an instance admin. Independent of datasets (the dataset source is covered by
 * `PaginationIntegrationTest`).
 *
 * Prerequisites:
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev SF_OUTPUT_ROOT=<dir> ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`
 *     (port 8081, instance admin `Admin` / `Admin`).
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<same dir as SF_OUTPUT_ROOT> npx playwright test e2e/m21-journeys.spec.ts`.
 *     Without `SF_E2E_OUTPUT_ROOT` steps 5–6 check the runs and not the generated files.
 *
 * The access token is memory-only: after the login every navigation goes through the router.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';
const OUTPUT_ROOT = process.env['SF_E2E_OUTPUT_ROOT'];

test.use({ baseURL: BASE_URL });

type Json = Record<string, any>;

const BLOG_CDL =
  'content {\n  editor pagination posts { label "Posts" sources ["nav"] pageSize 2 sort ["navigation"] }\n}\n';
const BLOG_HTML =
  '<html><body><h1>Blog $CMS_VALUE(CMS_PAGINATION.current)$ of $CMS_VALUE(CMS_PAGINATION.total)$</h1>\n' +
  '<ul>$CMS_FOR(post : CMS_PAGINATION.items)$<li><a class="post" href="$CMS_VALUE(post.href)$">$CMS_VALUE(post.label)$</a></li>$CMS_END_FOR$</ul>\n' +
  '$CMS_IF(CMS_PAGINATION.prevHref)$<a rel="prev" href="$CMS_VALUE(CMS_PAGINATION.prevHref)$">Previous</a>$CMS_END_IF$\n' +
  '$CMS_IF(CMS_PAGINATION.nextHref)$<a rel="next" href="$CMS_VALUE(CMS_PAGINATION.nextHref)$">Next</a>$CMS_END_IF$\n' +
  '</body></html>';

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
    await api.post('/api/v1/projects', { key, name: `M21 ${prefix}` });
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

  async delete(p: string): Promise<void> {
    const res = await this.ctx.delete(this.url(p));
    expect(res.ok(), `DELETE ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
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

function buildDir(projectKey: string, targetId: number, runId: number): string {
  return path.join(OUTPUT_ROOT!, projectKey, `target-${targetId}`, 'builds', String(runId));
}

/** Every href of every generated HTML file, resolved against its own page, that points at no generated file. */
function brokenLinks(root: string): string[] {
  const broken: string[] = [];
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
  for (const file of walk(root).filter((f) => f.endsWith('.html'))) {
    for (const match of fs.readFileSync(file, 'utf8').matchAll(/href="([^"#?]*)"/g)) {
      const link = match[1];
      if (!link || link.includes(':')) {
        continue;
      }
      let target = path.resolve(path.dirname(file), link);
      if (link.endsWith('/')) {
        target = path.join(target, 'index.html');
      }
      if (!target.startsWith(root) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        broken.push(`${path.relative(root, file)} -> ${link}`);
      }
    }
  }
  return broken;
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

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey: one page generates a paginated listing', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await Api.forNewProject('m21a');
  try {
    await login(page);

    // 1. The developer declares the pagination editor and the listing channel in the Templates store.
    await navigate(page, `/p/${api.projectKey}/templates`);
    const screen = page.locator('sf-templates');
    await expect(screen.getByRole('treeitem', { name: /Page Templates/ })).toBeVisible();
    await screen.getByRole('button', { name: 'New template', exact: true }).click();
    await page.locator('sf-create-asset-dialog input').first().fill('Blog index');
    await page.locator('sf-create-asset-dialog').getByRole('button', { name: /create/i }).click();
    await expect(screen.locator('.detail__head h3')).toHaveText('Blog index');
    await screen.getByRole('textbox', { name: 'Content definition (CDL) — Content' }).fill(cdl(BLOG_CDL).contentCdl);
    // The channel is staged; the one Save writes it with the definition (M34).
    await screen.getByRole('combobox', { name: 'Add channel' }).selectOption('html');
    const channel = screen.getByRole('textbox', { name: 'OCTL source for channel html' });
    await channel.fill(BLOG_HTML);
    const savedDefinition = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/page-templates/'));
    await screen.getByRole('button', { name: 'Save template', exact: true }).click();
    const definitionResponse = await savedDefinition;
    expect(definitionResponse.status(), await definitionResponse.text()).toBe(200);

    // The template's pagination path: a pattern without {pageNumber} is flagged, a valid one is saved.
    const paths = screen.getByRole('group', { name: 'Pagination paths' });
    const htmlPath = paths.getByRole('textbox', { name: 'Pagination path for channel html' });
    await expect(htmlPath).toHaveAttribute('placeholder', '{pagePath}-{pageNumber}.{ext}');
    await htmlPath.fill('{pagePath}/page.{ext}');
    await expect(paths.getByRole('alert')).toContainText('{pageNumber}');
    await htmlPath.fill('{pagePath}/page-{pageNumber}.{ext}');
    await expect(paths.getByRole('alert')).toHaveCount(0);
    const savedPaths = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes('/page-templates/'));
    await screen.getByRole('button', { name: 'Save template', exact: true }).click();
    expect((await savedPaths).status()).toBe(200);
    await snap(page, 'j1-pagination-path');
    const blogTemplate = (await api.get('/page-templates')).content.find((t: Json) => t.displayName === 'Blog index');
    expect((await api.get(`/page-templates/${blogTemplate.uuid}`)).paginationPath).toEqual({
      html: '{pagePath}/page-{pageNumber}.{ext}',
    });

    // 2. Five posts listed by a navigation folder (reference names fix the order).
    const postTemplate = await api.post('/page-templates', {
      displayName: 'Post',
      ...cdl(''),
      channelSources: { html: '<html><body><article>post</article></body></html>' },
      outputPath: { html: 'posts/{displayNameSlug}.{ext}' },
    });
    const navFolder = await api.post('/folders', { displayName: 'Blog', scope: 'NAVIGATION' });
    const references: Json[] = [];
    for (let i = 1; i <= 5; i++) {
      const post = await api.post('/pages', { displayName: `Post ${i}`, templateUuid: postTemplate.uuid });
      references.push(
        await api.post('/navigation/references', {
          displayName: `0${i} post`,
          folderUuid: navFolder.uuid,
          targetKind: 'PAGE',
          targetAssetUuid: post.uuid,
        }),
      );
    }

    // 3. The editor creates the blog page and picks the folder and the page size in the pagination field.
    const blog = await api.post('/pages', { displayName: 'Blog', templateUuid: blogTemplate.uuid });
    await navigate(page, `/p/${api.projectKey}/pages/${blog.uuid}`);
    await expect(page.locator('sf-page-editor')).toBeVisible({ timeout: 15_000 });
    const field = page.locator('sf-page-editor sf-pagination-editor');
    await expect(field.getByRole('group', { name: 'Posts' })).toBeVisible();
    await field.getByLabel('Items per page').fill('2');
    await field.getByRole('button', { name: 'Choose source…' }).click();
    const picker = page.getByRole('dialog', { name: 'Choose a source' });
    await expect(picker.getByRole('button', { name: /^All Navigation/ })).toBeVisible();
    await snap(page, 'j3-source-picker');
    await picker.getByRole('searchbox').fill('blo');
    await picker.getByRole('button', { name: /^Blog/ }).click();
    await expect(picker).toHaveCount(0);
    await expect(field.locator('.sf-pagination__name')).toHaveText('Blog');
    await expect(field.locator('.sf-pagination__hint')).toHaveText('5 items → 3 pages', { timeout: 10_000 });
    await expect
      .poll(async () => (await api.get(`/pages/${blog.uuid}`)).content?.posts ?? null, { timeout: 20_000 })
      .toEqual({ type: 'PAGINATION', source: { kind: 'NAV', uuid: navFolder.uuid }, pageSize: 2, sort: { key: 'navigation', direction: 'ASC' } });
    await snap(page, 'j3-pagination-field');

    // 4. Preview: three pages; the selector and a pagination link in the frame switch pages.
    const selector = page.locator('sf-preview-frame').getByRole('group', { name: 'Preview page' });
    await expect(selector.getByRole('combobox')).toHaveValue('1', { timeout: 20_000 });
    await expect(selector.locator('option')).toHaveText(['Page 1 of 3', 'Page 2 of 3', 'Page 3 of 3']);
    const preview = previewBody(page);
    await expect(preview.locator('a.post')).toHaveText(['Post 1', 'Post 2']);
    await selector.getByRole('button', { name: 'Next page' }).click();
    await expect(preview.locator('h1')).toHaveText('Blog 2 of 3', { timeout: 10_000 });
    await expect(preview.locator('a.post')).toHaveText(['Post 3', 'Post 4']);
    await preview.locator('a[rel="next"]').click();
    await expect(selector.getByRole('combobox')).toHaveValue('3', { timeout: 10_000 });
    await expect(preview.locator('a.post')).toHaveText(['Post 5']);
    await expect(preview.locator('a[rel="next"]')).toHaveCount(0);
    // At a 1280px window the preview pane and its whole toolbar stay on screen (the desktop frame scrolls inside).
    expect(page.viewportSize()?.width).toBe(1280);
    await expect(selector).toBeInViewport({ ratio: 1 });
    await expect(page.locator('sf-preview-frame').getByRole('button', { name: 'Refresh' })).toBeInViewport({ ratio: 1 });
    const pane = await page.locator('sf-preview-frame').boundingBox();
    expect((pane?.x ?? 0) + (pane?.width ?? 0)).toBeLessThanOrEqual(1280);
    // ...without pushing the editor column aside: its title and the pagination field stay beside the page tree.
    const tree = await page.locator('sf-pages-list .pages__tree').boundingBox();
    const editorTitle = await page.locator('sf-page-editor .page-editor__title').boundingBox();
    expect(editorTitle?.x ?? 0).toBeGreaterThanOrEqual((tree?.x ?? 0) + (tree?.width ?? 0));
    await expect(field.getByRole('button', { name: 'Change source…' })).toBeInViewport({ ratio: 1 });
    await snap(page, 'j4-preview-page-3');
    await selector.getByRole('combobox').selectOption('1');
    await expect(preview.locator('h1')).toHaveText('Blog 1 of 3', { timeout: 10_000 });

    // 5. FULL: three files, page 1 at the page's own path, no broken links.
    const target = await api.target();
    const full = await api.generate('FULL', target.id);
    expect(full.status, JSON.stringify(full.diagnostics)).toBe('SUCCESS');
    if (OUTPUT_ROOT) {
      const dir = buildDir(api.projectKey, target.id, full.id);
      for (const file of ['blog.html', 'blog/page-2.html', 'blog/page-3.html']) {
        expect(fs.existsSync(path.join(dir, file)), file).toBe(true);
      }
      const page3 = fs.readFileSync(path.join(dir, 'blog/page-3.html'), 'utf8');
      expect(page3).toContain('<a class="post" href="../posts/post-5.html">Post 5</a>');
      expect(page3).toContain('<a rel="prev" href="page-2.html">');
      expect(brokenLinks(dir)).toEqual([]);
    }

    // 6. Removing a reference shrinks the listing: INCREMENTAL publishes two pages.
    await api.delete(`/navigation/references/${references[4].uuid}`);
    const incremental = await api.generate('INCREMENTAL', target.id);
    expect(incremental.status, JSON.stringify(incremental.diagnostics)).toBe('SUCCESS');
    if (OUTPUT_ROOT) {
      const dir = buildDir(api.projectKey, target.id, incremental.id);
      expect(fs.existsSync(path.join(dir, 'blog.html'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'blog/page-2.html'))).toBe(true);
      expect(fs.existsSync(path.join(dir, 'blog/page-3.html'))).toBe(false);
      expect(fs.readFileSync(path.join(dir, 'blog/page-2.html'), 'utf8')).not.toContain('rel="next"');
    }
  } finally {
    await api.dispose();
  }
});
