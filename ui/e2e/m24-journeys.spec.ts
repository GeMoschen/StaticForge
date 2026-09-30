import { test, expect, request as playwrightRequest, APIRequestContext, Page } from '@playwright/test';
import { cdl as cdlFields } from './cdl';

/**
 * M24 multi-language journey (feature `docs-e2e`, `M24.6.1`).
 *
 * The whole flow the epic promises, in one pass:
 *   1. an admin enables `de` (default) + `en` in Settings → Languages and confirms the URL-change warning;
 *   2. a developer marks `headline` localizable on the page template;
 *   3. an editor switches the editing language to English, sees the German fallback on the untranslated
 *      field, translates it, and previews the English page;
 *   4. a generation run writes `de/…` and `en/…`, the sitemap carries `hreflang` alternates, and every
 *      generated link resolves against the page that holds it (the link check `tasks/lessons.md` requires);
 *   5. changing only the English headline plans that page's English entry alone (M22 plan view).
 *
 * Prerequisites (as for the M16–M23 journeys):
 *   - Backend: `SPRING_PROFILES_ACTIVE=dev ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m24-journeys.spec.ts`.
 *
 * Execution status: not run here (no seeded dev backend in this environment) — the same standing
 * limitation recorded for every journey since M5. The equivalent behaviour is proven server-side by
 * `LocalizedGenerationIntegrationTest`, `LocalizationMigrationIntegrationTest` and
 * `ProjectLocalesApiTest` in `server/sf-app`, which exercise the identical flow through the real
 * services, including the link check over the generated output.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

test.use({ baseURL: BASE_URL });

type Json = Record<string, any>;

const PAGE_CDL_PLAIN = `content {
  editor text headline { label "Headline" }
}`;

const PAGE_CDL_LOCALIZED = `content {
  editor text headline { label "Headline" localizable }
}`;

/** Prints the headline, the `lang` attribute, a link to `about` and a language switcher. */
const PAGE_HTML =
  '<html lang="$CMS_META(language)$"><body><h1>$CMS_VALUE(headline)$</h1>' +
  '$CMS_FOR(l : CMS_LOCALES)$<a href="$CMS_VALUE(l.href)$">$CMS_VALUE(l.code)$</a>$CMS_END_FOR$' +
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
    await api.post('/api/v1/projects', { key, name: `M24 ${prefix}` });
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

  async createPageTemplate(displayName: string, cdl: string): Promise<Json> {
    return this.post('/page-templates', {
      displayName,
      ...cdlFields(cdl),
      channelSources: { html: PAGE_HTML },
      outputPath: { html: '{locale}/{folder}{uid}.{ext}' },
    });
  }

  /** Merge-patches a page's content at its current revision (the shape M22's journey established). */
  async patchContent(pageUuid: string, content: Json): Promise<Json> {
    const current = await this.get(`/pages/${pageUuid}`);
    const res = await this.ctx.patch(this.url(`/pages/${pageUuid}/content`), {
      data: { content },
      headers: { 'If-Match': `"rev-${current.revision}"`, 'Content-Type': 'application/merge-patch+json' },
    });
    expect(res.ok(), `patch content → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async createPage(displayName: string, templateUuid: string): Promise<Json> {
    return this.post('/pages', { displayName, templateUuid });
  }

  /** Waits for a generation run to reach a terminal state and returns it. */
  async awaitRun(runId: number): Promise<Json> {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const run = await this.get(`/generations/${runId}`);
      if (!['QUEUED', 'RUNNING'].includes(run.status)) {
        return run;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`generation run ${runId} did not finish within 60s`);
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

test('journey: configure languages, translate, preview, generate and rebuild one language', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');

  const api = await Api.forNewProject('e2e-m24-');
  const template = await api.createPageTemplate('Article', PAGE_CDL_PLAIN);
  const about = await api.createPage('About', template.uuid);
  await api.patchContent(about.uuid, { headline: 'Über uns' });

  await login(page);

  // ── 1. Admin enables de + en and confirms the URL change ──────────────
  await navigate(page, `/p/${api.projectKey}/settings/locales`);
  await expect(page.locator('sf-project-settings-locales')).toBeVisible();

  // Nothing edited yet: there is nothing to save.
  const saveLanguages = page.getByRole('button', { name: /Save languages|Saving/ });
  await expect(saveLanguages).toBeDisabled();

  await page.getByRole('button', { name: 'Add language' }).click();
  await page.locator('sf-project-settings-locales .locale').nth(0).locator('input').first().fill('de');
  await page.locator('sf-project-settings-locales .locale').nth(0).locator('input').nth(1).fill('Deutsch');
  await page.getByRole('button', { name: 'Add language' }).click();
  await page.locator('sf-project-settings-locales .locale').nth(1).locator('input').first().fill('en');
  await page.locator('sf-project-settings-locales .locale').nth(1).locator('input').nth(1).fill('English');
  // The default language is deliberately *not* picked here: the select already shows the first
  // language, so the form must accept it without a redundant click (regression: save stayed
  // disabled forever because the untouched select left the default language empty).
  await expect(saveLanguages).toBeEnabled();
  await snap(page, 'languages-tab');

  await saveLanguages.click();

  // The URL-change warning names a real page of this project, before and after.
  const dialog = page.getByRole('dialog', { name: 'This changes every page URL' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('about.html');
  await expect(dialog).toContainText('de/about.html');
  await snap(page, 'url-change-warning');
  await dialog.getByRole('button', { name: 'Save and change URLs' }).click();
  // The saved configuration is what the form now shows, so there is nothing left to save. (The
  // success toast is not asserted: ToastService has no host component, so no toast is rendered.)
  await expect(saveLanguages).toBeDisabled({ timeout: 10_000 });
  await expect(page.getByRole('combobox', { name: 'Editing language' })).toBeVisible();

  // ── 2. Developer marks `headline` localizable ─────────────────────────
  await api.put(
    `/page-templates/${template.uuid}`,
    {
      displayName: 'Article',
      ...cdlFields(PAGE_CDL_LOCALIZED),
      channelSources: { html: PAGE_HTML },
      outputPath: { html: '{locale}/{folder}{uid}.{ext}' },
    },
    { 'If-Match': `"rev-${(await api.get(`/page-templates/${template.uuid}`)).revision}"` },
  );

  // The German value moved into the wrapper, in one revision.
  const migrated = await api.get(`/pages/${about.uuid}`);
  expect(migrated.content.headline).toMatchObject({ type: 'L10N', values: { de: 'Über uns' } });

  // ── 3. Editor switches to English, sees the fallback, translates ──────
  await navigate(page, `/p/${api.projectKey}/pages/${about.uuid}`);
  await expect(page.locator('sf-page-editor')).toBeVisible();

  const languagePicker = page.getByLabel('Editing language');
  await expect(languagePicker).toBeVisible();
  const headline = page.locator('sf-content-form input').first();
  await expect(headline).toHaveValue('Über uns');
  await languagePicker.selectOption('en');

  // Switching the language rebuilds the form: the English field is empty, not still holding the
  // German text it was built with — the editors would otherwise save German words as English.
  await expect(headline).toHaveValue('');

  // The untranslated English field shows what the page will render, and where it comes from.
  const fallback = page.locator('sf-content-form .sf-content-form__fallback');
  await expect(fallback).toContainText('Not translated');
  await expect(fallback).toContainText('Über uns');
  await expect(fallback).toContainText('Deutsch');
  await snap(page, 'fallback-hint');

  // The status starts out as "Saved", so waiting for the autosave request is what proves the
  // translation reached the server — the label alone would match before the edit was flushed.
  const autosaved = page.waitForResponse(
    (response) =>
      response.url().includes(`/pages/${about.uuid}/content`) &&
      response.request().method() === 'PATCH' &&
      response.ok(),
    { timeout: 15_000 },
  );
  await headline.fill('About us');
  await autosaved;
  await expect(page.locator('sf-page-editor .page-editor__status')).toContainText(/Saved/i);

  // Both languages live in one value; German was not touched.
  const translated = await api.get(`/pages/${about.uuid}`);
  expect(translated.content.headline.values).toMatchObject({ de: 'Über uns', en: 'About us' });

  // Switching back shows German again — each language keeps its own words across a switch.
  await languagePicker.selectOption('de');
  await expect(headline).toHaveValue('Über uns');
  await languagePicker.selectOption('en');
  await expect(headline).toHaveValue('About us');

  // 3b. The preview renders the language being edited.
  const preview = page.locator('sf-preview-frame iframe');
  await expect(preview).toBeVisible();
  await expect(preview.contentFrame().locator('h1')).toHaveText('About us', { timeout: 15_000 });
  await snap(page, 'english-preview');

  // ── 4. Generate: one output per language, hreflang, no broken links ───
  const target = await api.post('/generation-targets', {
    name: 'e2e',
    type: 'FILESYSTEM',
    config: { baseUrl: 'https://example.com' },
    isDefault: true,
  });
  const run = await api.post('/generations', { mode: 'FULL', channels: ['html'], targetId: target.id });
  const finished = await api.awaitRun(run.id);
  expect(finished.status, JSON.stringify(finished.diagnostics)).toMatch(/SUCCESS|PARTIAL/);

  const files: string[] = (await api.get(`/generations/${run.id}/files`)).map((f: Json) => f.path);
  expect(files).toEqual(expect.arrayContaining(['de/about.html', 'en/about.html', 'sitemap.xml']));

  const sitemap: string = await api.get(`/generations/${run.id}/files/sitemap.xml`);
  expect(sitemap).toContain('hreflang="de"');
  expect(sitemap).toContain('hreflang="en"');
  expect(sitemap).toContain('hreflang="x-default"');

  // Every href resolves against the page holding it (tasks/lessons.md).
  for (const file of files.filter((f) => f.endsWith('.html'))) {
    const html: string = await api.get(`/generations/${run.id}/files/${file}`);
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (!href || href.startsWith('#') || href.includes(':')) {
        continue;
      }
      const resolved = new URL(href, `https://x/${dir}`).pathname.replace(/^\//, '');
      expect(files, `${file} → ${href}`).toContain(resolved);
    }
  }

  // ── 5. Changing only English rebuilds only English ────────────────────
  await api.patchContent(about.uuid, {
    headline: { type: 'L10N', values: { de: 'Über uns', en: 'About our company' } },
  });

  const plan = await api.post('/generations/plan', {
    mode: 'INCREMENTAL',
    channels: ['html'],
    targetId: target.id,
  });
  expect(plan.summary.entryCount).toBe(1);
  expect(plan.entries.content[0].outputPath).toBe('en/about.html');
  await navigate(page, `/p/${api.projectKey}/settings/generation`);
  await snap(page, 'incremental-plan');

  await api.dispose();
});
