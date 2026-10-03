import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import { cdl } from './cdl';

/**
 * M23 global search journeys (feature `docs-e2e`, `M23.5.1`).
 *
 * "Find and fix":
 *   1. log in and open a project;
 *   2. a page whose rich-text value (not its name) holds a unique term;
 *   3. Ctrl+K, type the term: the page is listed under "Pages" (combobox/listbox ARIA in place);
 *   4. Enter opens the page editor;
 *   5. the term is replaced in the rich-text editor and autosaved;
 *   6. Ctrl+K: the old term finds nothing for the page, the new term finds it; Esc closes and returns focus;
 *   7. the search page (Ctrl+Enter from the palette) filters by type and keeps the other types' facet counts.
 *
 * "Media by alt text": a media file's alt text is found from the palette and opens the media drawer through the
 * `?asset=` deep link; the deep link also works as a fresh in-app navigation.
 *
 * "Every result opens its asset": a section template (by its OCTL source), a navigation page reference (by label), a
 * global property set and a pages folder each open in their own screen from the palette.
 *
 * Prerequisites (as for the M16–M22 journeys):
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m23-journeys.spec.ts`.
 *
 * The access token is memory-only: after the login every navigation goes through the router.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

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
    await api.post('/api/v1/projects', { key, name: `M23 ${prefix}` });
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

  async patchContent(pageUuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/pages/${pageUuid}`);
    const res = await this.ctx.patch(this.url(`/pages/${pageUuid}/content`), {
      data: { content },
      headers: { 'If-Match': `"rev-${current.revision}"`, 'Content-Type': 'application/merge-patch+json' },
    });
    expect(res.ok(), `patch content → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async uploadText(fileName: string, text: string): Promise<Json> {
    const res = await this.ctx.post(this.url('/media'), {
      multipart: { file: { name: fileName, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') } },
    });
    expect(res.ok(), `upload → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async setAltText(mediaUuid: string, altText: string): Promise<Json> {
    const current = await this.get(`/assets/${mediaUuid}`);
    const res = await this.ctx.put(this.url(`/media/${mediaUuid}`), {
      data: { altText, caption: '', copyright: '' },
      headers: { 'If-Match': `"rev-${current.revision}"` },
    });
    expect(res.ok(), `metadata → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  /** Waits until the index has caught up with the project's latest revision. */
  async awaitIndexed(): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const status = await this.get('/search/status');
      if (status.state === 'READY' && status.lag === 0) {
        return;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error('search index did not catch up within 30s');
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(USER);
  await page.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
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

/** Opens the palette with Ctrl+K and types `term` into its combobox. */
async function paletteSearch(page: Page, term: string) {
  await page.keyboard.press('Control+k');
  const palette = page.getByRole('dialog', { name: 'Search' });
  await expect(palette).toBeVisible();
  const combobox = palette.getByRole('combobox');
  await expect(combobox).toBeFocused();
  await combobox.fill(term);
  return { palette, combobox, listbox: palette.getByRole('listbox') };
}

test.beforeEach(() => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
});

test('journey: find and fix', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await Api.forNewProject('m23a');
  const oldTerm = `quokka${Date.now() % 100000}`;
  const newTerm = `wombat${Date.now() % 100000}`;
  try {
    // 1–2. A page whose rich text holds the term; a media file that mentions it too, for the facets.
    const article = await api.post('/page-templates', {
      displayName: 'Article',
      ...cdl('content { editor richtext body { label "Body" } }'),
      channelSources: { html: '<main>$CMS_VALUE(body)$</main>' },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const page1 = await api.post('/pages', { displayName: 'Harbour notes', templateUuid: article.uuid });
    await api.patchContent(page1.uuid, { body: { format: 'html', value: `<p>Seen near the pier: a <strong>${oldTerm}</strong>.</p>` } });
    const media = await api.uploadText('pier.txt', 'pier');
    await api.setAltText(media.uuid, `A ${oldTerm} on the pier`);
    await api.awaitIndexed();

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages`);
    await expect(page.locator('sf-pages-list')).toBeVisible({ timeout: 15_000 });

    // 3. Ctrl+K finds the page by a word only its rich text holds.
    const pagesSearch = page.locator('sf-pages-list input[type="search"]').first();
    await pagesSearch.focus();
    const { palette, combobox, listbox } = await paletteSearch(page, oldTerm);
    const pageOption = listbox.getByRole('option', { name: /Harbour notes/ });
    await expect(pageOption).toBeVisible({ timeout: 10_000 });
    await expect(palette.getByRole('group', { name: /Pages/ })).toContainText('Harbour notes');
    await expect(pageOption.locator('mark')).toHaveText(oldTerm);
    await expect(combobox).toHaveAttribute('aria-expanded', 'true');
    await expect(combobox).toHaveAttribute('aria-controls', await listbox.getAttribute('id') ?? 'missing');
    await expect(listbox.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await expect(combobox).toHaveAttribute('aria-activedescendant', (await listbox.getByRole('option').first().getAttribute('id')) ?? '');
    await snap(page, 'j3-palette-results');

    // Esc closes and gives focus back.
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
    await expect(pagesSearch).toBeFocused();

    // 4. Arrow to the page (pages group first) and Enter opens the editor.
    await paletteSearch(page, oldTerm);
    await expect(page.getByRole('option', { name: /Harbour notes/ })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/p/${api.projectKey}/pages/${page1.uuid}`));
    const editor = page.locator('sf-page-editor');
    await expect(editor).toBeVisible({ timeout: 15_000 });

    // 5. Replace the term in the rich-text editor; autosave stores it.
    const body = editor.locator('.sf-richtext__body');
    await expect(body).toContainText(oldTerm, { timeout: 15_000 });
    const saved = page.waitForResponse(
      (r) => r.url().includes(`/pages/${page1.uuid}`) && ['PUT', 'PATCH'].includes(r.request().method()) && r.ok(),
      { timeout: 20_000 },
    );
    await body.click();
    await page.keyboard.press('Control+a');
    await page.keyboard.type(`Seen near the pier: a ${newTerm}.`);
    await saved;
    await api.awaitIndexed();
    await snap(page, 'j5-edited');

    // 6. The old term no longer finds the page; the new one does.
    await body.blur();
    const old = await paletteSearch(page, oldTerm);
    await expect(old.listbox.getByRole('option', { name: /pier\.txt/ })).toBeVisible({ timeout: 10_000 });
    await expect(old.listbox.getByRole('option', { name: /Harbour notes/ })).toHaveCount(0);
    await old.combobox.fill(newTerm);
    await expect(old.listbox.getByRole('option', { name: /Harbour notes/ })).toBeVisible({ timeout: 10_000 });
    await expect(old.palette.locator('[aria-live="polite"]')).toHaveText('1 result');

    // 7. Ctrl+Enter opens the search page; a type filter keeps the other type's count.
    await old.combobox.fill(oldTerm);
    await expect(old.listbox.getByRole('option', { name: /pier\.txt/ })).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Control+Enter');
    await expect(page).toHaveURL(new RegExp(`/p/${api.projectKey}/search\\?q=${oldTerm}`));
    const searchPage = page.locator('sf-search-page');
    await expect(searchPage.locator('.search__count')).toContainText(`1 result for “${oldTerm}”`, { timeout: 15_000 });
    await expect(searchPage.locator('.search__revisions')).toContainText('Indexed revision');

    // Seed one more page holding the old term, so both facets have counts.
    const page2 = await api.post('/pages', { displayName: 'Pier log', templateUuid: article.uuid });
    await api.patchContent(page2.uuid, { body: { format: 'html', value: `<p>Another ${oldTerm} sighting.</p>` } });
    await api.awaitIndexed();
    await searchPage.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(searchPage.locator('.search__count')).toContainText('2 results', { timeout: 15_000 });

    const mediaFacet = searchPage.getByRole('checkbox', { name: /Media/ });
    await mediaFacet.check();
    await expect(page).toHaveURL(/type=MEDIA/);
    await expect(searchPage.locator('.search__count')).toContainText('1 result', { timeout: 15_000 });
    await expect(searchPage.locator('.search__facet', { hasText: 'Pages' }).locator('.search__facet-count')).toHaveText('1');
    await expect(searchPage.locator('.search__facet', { hasText: 'Media' }).locator('.search__facet-count')).toHaveText('1');
    await expect(searchPage.locator('.search__hit')).toHaveCount(1);
    await expect(searchPage.locator('.search__hit mark')).toHaveText(oldTerm);
    await snap(page, 'j7-search-page-facets');

    // Back restores the unfiltered state.
    await page.goBack();
    await expect(page).not.toHaveURL(/type=MEDIA/);
    await expect(searchPage.locator('.search__count')).toContainText('2 results', { timeout: 15_000 });
  } finally {
    await api.dispose();
  }
});

test('journey: media by alt text opens the drawer', async ({ page }) => {
  test.setTimeout(120_000);
  const api = await Api.forNewProject('m23b');
  const term = `albatross${Date.now() % 100000}`;
  try {
    const media = await api.uploadText('gull.txt', 'gull');
    await api.setAltText(media.uuid, `An ${term} gliding`);
    await api.awaitIndexed();

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages`);
    await expect(page.locator('sf-pages-list')).toBeVisible({ timeout: 15_000 });

    const { listbox } = await paletteSearch(page, term);
    const option = listbox.getByRole('option', { name: /gull\.txt/ });
    await expect(option).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Enter');

    const drawer = page.locator('body > sf-drawer');
    await expect(drawer.getByRole('heading', { level: 2, name: 'gull.txt' })).toBeVisible({ timeout: 15_000 });
    // The open file is part of the URL (?asset=), so the link can be shared and reloaded.
    await expect(page).toHaveURL(new RegExp(`/p/${api.projectKey}/media\\?asset=${media.uuid}`));
    await snap(page, 'm1-media-drawer');

    // The deep link as a fresh in-app navigation.
    await navigate(page, `/p/${api.projectKey}/pages`);
    await expect(page.locator('sf-pages-list')).toBeVisible();
    await navigate(page, `/p/${api.projectKey}/media?asset=${media.uuid}`);
    await expect(page.locator('body > sf-drawer').getByRole('heading', { level: 2, name: 'gull.txt' })).toBeVisible({ timeout: 15_000 });
  } finally {
    await api.dispose();
  }
});

test('journey: every result opens its asset', async ({ page }) => {
  test.setTimeout(180_000);
  const api = await Api.forNewProject('m23c');
  const term = `puffin${Date.now() % 100000}`;
  try {
    const teaser = await api.post('/section-templates', {
      displayName: 'Coast teaser',
      ...cdl(''),
      channelSources: { html: `<h2>${term} teaser</h2>` },
    });
    const article = await api.post('/page-templates', {
      displayName: 'Article',
      ...cdl(''),
      channelSources: { html: '<main></main>' },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const target = await api.post('/pages', { displayName: 'Cliffs', templateUuid: article.uuid });
    const navigationRoot = (await api.get('/folders?scope=NAVIGATION&depth=1'))[0];
    await api.post('/navigation/references', {
      displayName: 'Cliffs link',
      folderUuid: navigationRoot.uuid,
      targetKind: 'PAGE',
      targetAssetUuid: target.uuid,
      label: `See the ${term} cliffs`,
    });
    await api.post('/globals', { displayName: `Seabird ${term} settings`, ...cdl('') });
    const pagesRoot = (await api.get('/folders?scope=PAGES&depth=1'))[0];
    await api.post('/folders', { displayName: `Colony ${term}`, parentFolderUuid: pagesRoot.uuid, scope: 'PAGES' });
    await api.awaitIndexed();

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages`);
    await expect(page.locator('sf-pages-list')).toBeVisible({ timeout: 15_000 });

    const open = async (name: RegExp) => {
      const { listbox } = await paletteSearch(page, term);
      const option = listbox.getByRole('option', { name });
      await expect(option).toBeVisible({ timeout: 10_000 });
      await option.click();
    };

    // A section template, found by its source.
    await open(/Coast teaser/);
    await expect(page).toHaveURL(new RegExp(`/p/${api.projectKey}/templates`));
    await expect(page.locator('sf-templates .detail__head h3')).toHaveText('Coast teaser', { timeout: 15_000 });
    await snap(page, 'd1-template');

    // A navigation page reference, found by its label.
    await open(/Cliffs link/);
    await expect(page.locator('sf-navigation .nav-ref-detail__title')).toHaveText('Cliffs link', { timeout: 15_000 });

    // A global property set.
    await open(/Seabird/);
    await expect(page.locator('sf-globals .global-detail__title h2')).toHaveText(`Seabird ${term} settings`, { timeout: 15_000 });

    // A pages folder.
    await open(/Colony/);
    await expect(page.locator('sf-pages-list .folder-detail__title')).toHaveText(`Colony ${term}`, { timeout: 15_000 });
    await expect(page).toHaveURL(new RegExp(`/p/${api.projectKey}/pages$`));

    // The template deep link again, now that the templates screen has another template selected.
    await navigate(page, `/p/${api.projectKey}/templates?asset=${article.uuid}`);
    await expect(page.locator('sf-templates .detail__head h3')).toHaveText('Article', { timeout: 15_000 });
    await navigate(page, `/p/${api.projectKey}/templates?asset=${teaser.uuid}`);
    await expect(page.locator('sf-templates .detail__head h3')).toHaveText('Coast teaser', { timeout: 15_000 });
  } finally {
    await api.dispose();
  }
});

test('journey: time travel note and narrow search page', async ({ page }) => {
  test.setTimeout(120_000);
  const api = await Api.forNewProject('m23d');
  const term = `gannet${Date.now() % 100000}`;
  try {
    const article = await api.post('/page-templates', {
      displayName: 'Article',
      ...cdl('content { editor richtext body { label "Body" } }'),
      channelSources: { html: '<main>$CMS_VALUE(body)$</main>' },
      outputPath: { html: '{displayNameSlug}.{ext}' },
    });
    const created = await api.post('/pages', { displayName: 'Rocks', templateUuid: article.uuid });
    await api.patchContent(created.uuid, { body: { format: 'html', value: `<p>A ${term} dives.</p>` } });
    await api.awaitIndexed();

    await login(page);
    await navigate(page, `/p/${api.projectKey}/pages`);
    await expect(page.locator('sf-pages-list')).toBeVisible({ timeout: 15_000 });

    // Time travel: the palette says results are current, and opening one returns to now.
    await page.locator('nav.spine button').last().click();
    await expect(page.locator('.shell__timemachine')).toBeVisible({ timeout: 10_000 });
    const { palette, listbox } = await paletteSearch(page, term);
    await expect(palette).toContainText('Results reflect the current revision.');
    await expect(listbox.getByRole('option', { name: /Rocks/ })).toBeVisible({ timeout: 10_000 });
    await snap(page, 't1-time-travel-palette');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/pages/${created.uuid}`));
    await expect(page.locator('.shell__timemachine')).toHaveCount(0);

    // 400 px: the facets collapse behind a toggle above the results, nothing overflows sideways.
    await page.setViewportSize({ width: 400, height: 800 });
    await navigate(page, `/p/${api.projectKey}/search?q=${term}`);
    const searchPage = page.locator('sf-search-page');
    await expect(searchPage.locator('.search__count')).toContainText('1 result', { timeout: 15_000 });
    const toggle = searchPage.getByRole('button', { name: /Filters/ });
    await expect(toggle).toBeVisible();
    await expect(searchPage.getByRole('checkbox', { name: /Pages/ })).toBeHidden();
    await toggle.click();
    await expect(searchPage.getByRole('checkbox', { name: /Pages/ })).toBeVisible();
    await expect(searchPage.locator('.search__hit mark')).toHaveText(term);
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('sf-search-page') as HTMLElement;
      return main.scrollWidth - main.clientWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await snap(page, 't2-search-400px');
  } finally {
    await api.dispose();
  }
});
