import { test, expect, request as playwrightRequest, APIRequestContext, Browser, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

/**
 * M27 release and scheduling journey (feature `docs-e2e`, `M27.7.2`) — the editorial flow of the epic in the running
 * app, every step as a user does it:
 *   1. pages start `New`; releasing page A proposes its media (ticked), both pages are released in DE and EN and a
 *      build puts them online;
 *   2. an EN headline edit is `Changed` in EN only; the preview shows it in Draft, the old text in Published; a build
 *      leaves the EN output as it was;
 *   3. the Changes view lists it with a diff of the headline alone; releasing it there changes the EN output only;
 *   4. a UID change is a structural draft (both languages `Changed`); releasing EN only moves the EN output;
 *   5. localizing the media and releasing an EN file writes `en/assets/media/…`, DE pages keep the DE file;
 *   6. a release scheduled two minutes ahead (pinned, then generate) stays pinned when the page is edited again,
 *      runs on time and the history links its revision and generation run;
 *   7. a recurring generation "every minute" shows its next runs, runs once and is cancelled;
 *   8. deleting a published page is `Deletion pending` and stays online until the deletion is released;
 *   9. export and import with "Keep release state" reproduce the statuses;
 *  10. an `EDITOR` sees statuses and the Changes view, but no release or schedule actions.
 *
 * Prerequisites (the M16–M26 journeys' stack, plus a fast scheduler):
 *   - Backend on a clean database with a short scheduler poll:
 *     `SPRING_PROFILES_ACTIVE=dev SF_DB_FILE=<scratch>/db SF_OUTPUT_ROOT=<scratch>/out SF_SCHEDULER_POLL_INTERVAL=2s
 *      ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     SF_E2E_OUTPUT_ROOT=<scratch>/out npx playwright test e2e/m27-journeys.spec.ts`.
 *
 * Self-seeding: the project skeleton (languages, template, two pages, one image) is created through the API with a
 * per-run key; everything the journey is about happens in the UI. Generated files are read from the target's
 * `current` directory. Waits are on observable state (badges, rows, the API's run and schedule status), never on
 * fixed sleeps beyond a schedule's time.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const ADMIN_USER = process.env['SF_E2E_USER'] ?? 'Admin';
const ADMIN_PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'Admin';
const OUTPUT_ROOT = process.env['SF_E2E_OUTPUT_ROOT'];
const SHOTS_DIR = process.env['SF_E2E_SHOTS_DIR'];

// A step that can't find its control fails within 30 s instead of running into the journey's overall timeout.
test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 }, actionTimeout: 30_000 });

const RUN = Date.now().toString(36);
const KEY = `m27e2e${RUN}`;
const COPY_KEY = `m27cp${RUN}`;
const EDITOR = `m27editor${RUN}`;
const EDITOR_PASSWORD = 'm27-editor-journey-pw';

type Json = Record<string, any>;

const CDL = `content {
  editor text headline { label "Headline" localizable required }
  editor media hero { label "Hero" }
}`;
const HTML = '<html><body><h1>$CMS_VALUE(headline)$</h1><img id="hero" src="$CMS_REF(hero)$"></body></html>';

/** A 1×1 PNG of one colour (red for DE, blue for EN), so the two files differ. */
function png(rgb: [number, number, number]): Buffer {
  const hex = rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
  const raw = Buffer.from(`00${hex}`, 'hex');
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc;
}

const DE_PNG = png([200, 30, 30]);
const EN_PNG = png([30, 30, 200]);

class Api {
  private constructor(
    private readonly ctx: APIRequestContext,
    readonly projectKey: string,
  ) {}

  static async signIn(projectKey: string, username = ADMIN_USER, password = ADMIN_PASSWORD): Promise<Api> {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const login = await anon.post('/api/v1/auth/login', { data: { username, password } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const token = (await login.json()).accessToken as string;
    await anon.dispose();
    const ctx = await playwrightRequest.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    return new Api(ctx, projectKey);
  }

  private url(p: string): string {
    return p.startsWith('/api') ? p : `/api/v1/projects/${this.projectKey}${p}`;
  }

  async get(p: string): Promise<any> {
    const res = await this.ctx.get(this.url(p));
    expect(res.ok(), `GET ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async post(p: string, data: unknown): Promise<any> {
    const res = await this.ctx.post(this.url(p), { data });
    expect(res.ok(), `POST ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  async put(p: string, data: unknown, headers?: Record<string, string>): Promise<any> {
    const res = await this.ctx.put(this.url(p), { data, headers });
    expect(res.ok(), `PUT ${p} → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  async patchContent(pageUuid: string, content: Json): Promise<void> {
    const current = await this.get(`/pages/${pageUuid}`);
    const res = await this.ctx.patch(this.url(`/pages/${pageUuid}/content`), {
      data: { content },
      headers: { 'If-Match': `"rev-${current.revision}"`, 'Content-Type': 'application/merge-patch+json' },
    });
    expect(res.ok(), `patch → ${res.status()} ${await res.text()}`).toBeTruthy();
  }

  async upload(name: string, bytes: Buffer): Promise<any> {
    const res = await this.ctx.post(this.url('/media'), {
      multipart: { file: { name, mimeType: 'image/png', buffer: bytes } },
    });
    expect(res.ok(), `upload → ${res.status()} ${await res.text()}`).toBeTruthy();
    return res.json();
  }

  /** The file a language renders, as the server stores it (uploads are normalized, so not the uploaded bytes). */
  async mediaBytes(uuid: string, locale: string): Promise<Buffer> {
    const res = await this.ctx.get(this.url(`/media/${uuid}/binary?locale=${locale}`));
    expect(res.ok(), `binary → ${res.status()}`).toBeTruthy();
    return res.body();
  }

  /** Release status per locale key, as the page DTO carries it. */
  async statuses(pageUuid: string): Promise<Record<string, string>> {
    const release = (await this.get(`/pages/${pageUuid}`)).release ?? {};
    return Object.fromEntries(Object.entries(release).map(([k, v]) => [k, (v as Json)['status']]));
  }

  /** Waits until the newest generation run is past `afterId` and finished, and returns it. */
  async awaitRun(afterId: number): Promise<Json> {
    let run: Json | null = null;
    await expect
      .poll(
        async () => {
          const runs = (await this.get('/generations')) as Json[];
          run = runs.find((r) => r['id'] > afterId) ?? null;
          return run && !['QUEUED', 'RUNNING'].includes(run['status']) ? run['status'] : 'pending';
        },
        { timeout: 90_000, intervals: [500] },
      )
      .toMatch(/SUCCESS|PARTIAL/);
    return run!;
  }

  async lastRunId(): Promise<number> {
    const runs = (await this.get('/generations')) as Json[];
    return runs.reduce((max, r) => Math.max(max, r['id'] ?? 0), 0);
  }

  dispose(): Promise<void> {
    return this.ctx.dispose();
  }
}

async function snap(page: Page, name: string): Promise<void> {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (SHOTS_DIR) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.copyFileSync(file, path.join(SHOTS_DIR, `m27-${name}.png`));
  }
}

async function signIn(page: Page, username: string, password: string): Promise<void> {
  page.on('dialog', (dialog) => void dialog.accept());
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
}

/** In-app navigation (the access token is memory-only: a reload would sign out). */
async function navigate(page: Page, url: string): Promise<void> {
  await page.evaluate((u) => {
    history.pushState(null, '', u);
    dispatchEvent(new PopStateEvent('popstate'));
  }, url);
}

async function rail(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

async function editingLanguage(page: Page, label: 'Deutsch' | 'English'): Promise<void> {
  await page.getByRole('combobox', { name: 'Editing language' }).selectOption({ label });
}

async function openPage(page: Page, name: string): Promise<void> {
  await rail(page, 'Pages');
  await page.locator('sf-page-nav-node .page-nav__name', { hasText: new RegExp(`^${name}$`) }).click();
  await expect(page.locator('sf-page-editor')).toBeVisible();
}

const bar = (page: Page) => page.locator('sf-page-editor sf-release-bar');

/** The editor's badge text for the editing language, e.g. "Changed". */
async function expectBadge(page: Page, text: string): Promise<void> {
  await expect(bar(page).locator('.bar__status sf-release-badge .badge')).toContainText(text, { timeout: 15_000 });
}

async function expectLocaleStatus(page: Page, tag: 'DE' | 'EN', label: string): Promise<void> {
  const title = tag === 'DE' ? `Deutsch: ${label}` : `English: ${label}`;
  await expect(bar(page).locator(`.bar__locale[title="${title}"]`)).toBeVisible({ timeout: 15_000 });
}

/** Types into the page's headline and waits for the autosave to land (the badge follows the saved state). */
async function setHeadline(page: Page, text: string): Promise<void> {
  const input = page.locator('sf-page-editor sf-content-form').getByRole('textbox', { name: /Headline/ });
  await input.fill(text);
  await expect(page.locator('.page-editor__status')).toContainText('Saved', { timeout: 15_000 });
}

/** Opens the release dialog from the editor's bar, optionally ticks every changed language, and releases. */
async function releaseFromBar(page: Page, options: { allLanguages?: boolean; expectDependency?: string } = {}): Promise<void> {
  await bar(page).getByRole('button', { name: 'Release…' }).click();
  const dialog = page.getByRole('dialog', { name: /^Release/ });
  if (options.allLanguages) {
    await dialog.getByRole('button', { name: 'All changed languages' }).click();
  }
  if (options.expectDependency) {
    const dependency = dialog.locator('.plan__dependency', { hasText: options.expectDependency }).first();
    await expect(dependency).toBeVisible();
    await expect(dependency.getByRole('checkbox')).toBeChecked();
  }
  const release = dialog.locator('.dialog__actions').getByRole('button', { name: 'Release', exact: true });
  await expect(release).toBeEnabled({ timeout: 10_000 });
  await release.click();
  await expect(dialog).toHaveCount(0);
}

/** Settings → Generation → New generation → Start (a full build); waits for the run. */
async function build(page: Page, api: Api): Promise<Json> {
  const before = await api.lastRunId();
  await rail(page, 'Settings');
  await page.getByRole('tab', { name: 'Generation' }).click();
  await page.getByRole('button', { name: 'New generation' }).click();
  const dialog = page.getByRole('dialog', { name: 'New generation' });
  await dialog.locator('input[type="radio"][value="FULL"]').check();
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  return api.awaitRun(before);
}

/** The live build: `current` is a link to it, or — where links aren't available (Windows) — a file naming it. */
function outputDir(targetId: number): string {
  const root = path.join(OUTPUT_ROOT!, KEY, `target-${targetId}`);
  const current = path.join(root, 'current');
  if (fs.existsSync(current) && fs.statSync(current).isFile()) {
    return path.join(root, 'builds', fs.readFileSync(current, 'utf8').trim());
  }
  return current;
}

function read(targetId: number, file: string): string | null {
  const full = path.join(outputDir(targetId), file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function mediaFile(targetId: number, dir: string, uid: string): Buffer | null {
  const folder = path.join(outputDir(targetId), dir);
  if (!fs.existsSync(folder)) {
    return null;
  }
  const name = fs.readdirSync(folder).find((f) => f.startsWith(`${uid}.`));
  return name ? fs.readFileSync(path.join(folder, name)) : null;
}

/** The element's box lies within the 1280 × 800 viewport. */
async function expectInViewport(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, 'element rendered').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1280);
}

async function editorSignIn(browser: Browser, api: Api): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(page, EDITOR, EDITOR_PASSWORD);
  await page.locator('a.card', { hasText: `M27 journey ${RUN}` }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${api.projectKey}`));
  return page;
}

test.describe('M27 release and scheduling journey', () => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');
  test.skip(!OUTPUT_ROOT, 'requires SF_E2E_OUTPUT_ROOT (the backend’s SF_OUTPUT_ROOT) to check the generated site');

  test('release, per-language release, Changes, localized media, schedules, deletion, export, roles', async ({ page, browser }) => {
    test.setTimeout(15 * 60_000);

    // ── Seed: the project skeleton (languages, template, two pages, one image, a target) ──
    const api = await Api.signIn(KEY);
    await api.post('/api/v1/projects', { key: KEY, name: `M27 journey ${RUN}` });
    const locales = {
      locales: [
        { code: 'de', label: 'Deutsch' },
        { code: 'en', label: 'English' },
      ],
      defaultLocale: 'de',
      fallbacks: {},
      defaultWithoutPrefix: true,
    };
    await api.put('/locales', locales);
    const template = await api.post('/page-templates', {
      displayName: 'Article',
      contentDefinition: CDL,
      channelSources: { html: HTML },
      outputPath: { html: '{locale}/{uid}.{ext}' },
    });
    const hero = await api.upload('hero.png', DE_PNG);
    const pageA = await api.post('/pages', { displayName: 'Alpha', templateUuid: template.uuid });
    const pageB = await api.post('/pages', { displayName: 'Beta', templateUuid: template.uuid });
    for (const [p, de, en] of [
      [pageA, 'Alpha DE', 'Alpha EN'],
      [pageB, 'Beta DE', 'Beta EN'],
    ] as const) {
      await api.patchContent(p.uuid, {
        headline: { type: 'L10N', values: { de, en } },
        hero: { type: 'MEDIA_REF', uuid: hero.uuid },
      });
    }
    const target = await api.post('/targets', {
      name: 'journey',
      type: 'FILESYSTEM',
      config: { baseUrl: 'https://example.com' },
      isDefault: true,
    });
    // The editor of step 10 (an account is admin work, not the journey's subject).
    const createdEditor = await api.post('/api/v1/admin/users', {
      username: EDITOR,
      email: `${EDITOR}@example.com`,
      displayName: `Eddie ${RUN}`,
      password: EDITOR_PASSWORD,
      mustChangePassword: false,
      memberships: [{ projectKey: KEY, role: 'EDITOR' }],
    });
    expect(createdEditor.id).toBeTruthy();

    await signIn(page, ADMIN_USER, ADMIN_PASSWORD);
    await page.locator('a.card', { hasText: `M27 journey ${RUN}` }).click();
    await expect(page).toHaveURL(new RegExp(`/p/${KEY}`));

    // ── 1. New pages; releasing A proposes the image; both pages in both languages; a build puts them online ──
    await openPage(page, 'Alpha');
    await expectBadge(page, 'New');
    await expectLocaleStatus(page, 'EN', 'New');
    await releaseFromBar(page, { allLanguages: true, expectDependency: 'hero' });
    await expectBadge(page, 'Published');
    await expectLocaleStatus(page, 'EN', 'Published');
    await openPage(page, 'Beta');
    await releaseFromBar(page, { allLanguages: true });
    await expectLocaleStatus(page, 'EN', 'Published');
    await build(page, api);
    expect(read(target.id, 'alpha.html')).toContain('Alpha DE');
    expect(read(target.id, 'en/alpha.html')).toContain('Alpha EN');
    expect(read(target.id, 'beta.html')).toContain('Beta DE');
    expect(read(target.id, 'en/beta.html')).toContain('Beta EN');
    const deFile = await api.mediaBytes(hero.uuid, 'de');
    expect(mediaFile(target.id, 'assets/media', hero.uid)).toEqual(deFile);
    await snap(page, '01-released');

    // ── 2. An EN edit is Changed in EN only; the preview shows Draft vs Published; a build keeps EN as it was ──
    await openPage(page, 'Alpha');
    await editingLanguage(page, 'English');
    await setHeadline(page, 'Alpha EN v2');
    await expectBadge(page, 'Changed');
    await expectLocaleStatus(page, 'DE', 'Published');
    await expectLocaleStatus(page, 'EN', 'Changed');
    // The editor with its release bar and preview holds at 1280 px.
    await expectInViewport(page, bar(page).getByRole('button', { name: 'Release…' }));
    await expectInViewport(page, page.getByRole('radiogroup', { name: /view/i }));
    const frame = page.locator('sf-preview-frame iframe').contentFrame();
    await expect(frame.locator('h1')).toHaveText('Alpha EN v2', { timeout: 15_000 });
    await page.getByRole('radio', { name: 'Published', exact: true }).click();
    await expect(frame.locator('h1')).toHaveText('Alpha EN', { timeout: 15_000 });
    await snap(page, '02-preview-published');
    await page.getByRole('radio', { name: 'Draft', exact: true }).click();
    await expect(frame.locator('h1')).toHaveText('Alpha EN v2', { timeout: 15_000 });
    await build(page, api);
    expect(read(target.id, 'en/alpha.html')).toContain('Alpha EN<');

    // ── 3. The Changes view lists the edit with a headline-only diff; releasing it there updates EN only ──
    await rail(page, 'Changes');
    const row = page.locator('.changes__row', { hasText: 'Alpha' }).filter({ hasText: 'EN' });
    await expect(row).toHaveCount(1);
    await row.click();
    const diff = page.locator('.changes__diff');
    await expect(diff.locator('.sf-diff__field')).toHaveCount(1);
    await expect(diff.locator('.sf-diff__path')).toHaveText('content.headline');
    await snap(page, '03-changes-diff');
    await row.getByRole('checkbox').check();
    await page.locator('.changes__actions').getByRole('button', { name: 'Release…', exact: true }).click();
    const changesDialog = page.getByRole('dialog', { name: /^Release/ });
    await changesDialog.locator('.dialog__actions').getByRole('button', { name: 'Release', exact: true }).click();
    await expect(page.locator('.changes__row', { hasText: 'Alpha' })).toHaveCount(0);
    await build(page, api);
    expect(read(target.id, 'en/alpha.html')).toContain('Alpha EN v2');
    expect(read(target.id, 'alpha.html')).toContain('Alpha DE');

    // ── 4. A UID change is structural: both languages Changed; the old path stays until released, per language ──
    await openPage(page, 'Beta');
    await page.locator('.page-editor__title-button').click();
    await page.getByRole('button', { name: 'Change UID' }).click();
    await page.locator('.uid-rename__input').fill('beta_new');
    await page.locator('.uid-rename__actions').getByRole('button', { name: 'Save' }).click();
    await page.locator('.page-editor__meta-footer').getByRole('button', { name: 'Close' }).click();
    await expectLocaleStatus(page, 'DE', 'Changed');
    await expectLocaleStatus(page, 'EN', 'Changed');
    await build(page, api);
    expect(read(target.id, 'beta.html')).toContain('Beta DE');
    expect(read(target.id, 'en/beta.html')).toContain('Beta EN');
    expect(read(target.id, 'en/beta_new.html')).toBeNull();
    // Editing language is English: the release dialog preselects EN alone.
    await openPage(page, 'Beta');
    await releaseFromBar(page);
    await expectLocaleStatus(page, 'EN', 'Published');
    await expectLocaleStatus(page, 'DE', 'Changed');
    await build(page, api);
    expect(read(target.id, 'en/beta_new.html')).toContain('Beta EN');
    expect(read(target.id, 'en/beta.html')).toBeNull();
    expect(read(target.id, 'beta.html')).toContain('Beta DE');
    expect(read(target.id, 'beta_new.html')).toBeNull();

    // ── 5. Localized media: an EN file, released for EN, is written under en/; DE keeps the DE file ──
    await rail(page, 'Media');
    await page.locator('sf-media-library').getByText('hero.png').first().click();
    const drawer = page.locator('sf-media-detail-drawer');
    await drawer.getByText('Different file per language').click();
    await drawer.locator('[data-locale="en"] input[type="file"]').setInputFiles({
      name: 'hero-en.png',
      mimeType: 'image/png',
      buffer: EN_PNG,
    });
    await expect(drawer.locator('[data-locale="en"]')).toContainText('hero-en.png');
    await drawer.locator('sf-release-bar').getByRole('button', { name: 'Release…' }).click();
    await page.getByRole('dialog', { name: /^Release/ }).locator('.dialog__actions').getByRole('button', { name: 'Release', exact: true }).click();
    await expect(drawer.locator('sf-release-bar .bar__locale[title="English: Published"]')).toBeVisible();
    await snap(page, '05-localized-media');
    await drawer.getByRole('button', { name: 'Close' }).first().click();
    await expect(drawer).toHaveCount(0);
    await build(page, api);
    const enFile = await api.mediaBytes(hero.uuid, 'en');
    expect(enFile).not.toEqual(deFile);
    expect(mediaFile(target.id, 'en/assets/media', hero.uid)).toEqual(enFile);
    expect(mediaFile(target.id, 'assets/media', hero.uid)).toEqual(deFile);
    expect(read(target.id, 'en/alpha.html')).toMatch(/src="assets\/media\//);
    expect(read(target.id, 'alpha.html')).toMatch(/src="assets\/media\//);

    // ── 6. A pinned scheduled release with then-generate: a later edit doesn't go online ──
    await openPage(page, 'Alpha');
    await setHeadline(page, 'Alpha EN v3');
    await bar(page).getByRole('button', { name: 'Schedule…' }).click();
    const scheduleDialog = page.getByRole('dialog', { name: /^Schedule/ });
    const when = await page.evaluate(() => {
      const d = new Date(Date.now() + 2 * 60_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
        zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
    });
    await expect(scheduleDialog).toContainText(`Time zone: ${when.zone}`);
    await scheduleDialog.getByLabel('Date').fill(when.date);
    await scheduleDialog.getByLabel('Time', { exact: true }).fill(when.time);
    await scheduleDialog.getByText('Generate right after (incremental build)').click();
    await scheduleDialog.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(scheduleDialog).toHaveCount(0);
    await expect(bar(page).locator('.bar__pending')).toContainText('Release scheduled for');
    await setHeadline(page, 'Alpha EN v4');
    await rail(page, 'Schedules');
    const releaseRow = page.locator('tbody tr', { hasText: 'Release' });
    await expect(releaseRow).toContainText('Draft changed since scheduled');
    await snap(page, '06-drift');
    const scheduleId = ((await api.get('/schedules?type=RELEASE')) as Json)['rows'][0]['id'] as number;
    const runBefore = await api.lastRunId();
    await expect
      .poll(async () => (await api.get(`/schedules/${scheduleId}`))['status'], { timeout: 4 * 60_000, intervals: [2_000] })
      .toBe('SUCCEEDED');
    await api.awaitRun(runBefore);
    expect(read(target.id, 'en/alpha.html')).toContain('Alpha EN v3');
    expect(await api.statuses(pageA.uuid)).toEqual({ de: 'PUBLISHED', en: 'CHANGED' });
    await rail(page, 'Pages');
    await rail(page, 'Schedules');
    await page.locator('tbody tr', { hasText: 'Release' }).getByRole('button', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: /^History/ });
    await expect(history.getByRole('link', { name: /^Revision r\d+/ })).toBeVisible();
    await expect(history.getByRole('link', { name: /^Generation run #\d+/ })).toBeVisible();
    await snap(page, '06-history');
    await history.getByRole('button', { name: 'Close' }).click();

    // ── 7. A recurring generation every minute: next runs shown, one execution, cancelled ──
    await page.getByRole('button', { name: 'New generation schedule' }).click();
    const recurring = page.getByRole('dialog', { name: /^Schedule/ });
    await recurring.getByRole('radio', { name: 'Recurring generation' }).check();
    await recurring.getByRole('radio', { name: 'Advanced (cron)' }).check();
    await recurring.getByLabel(/Cron expression/).fill('* * * * *');
    await expect(recurring.locator('.sched__preview li')).toHaveCount(5, { timeout: 10_000 });
    await recurring.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(recurring).toHaveCount(0);
    const recurringId = ((await api.get('/schedules?type=RECURRING_GENERATION')) as Json)['rows'][0]['id'] as number;
    await expect
      .poll(async () => ((await api.get(`/schedules/${recurringId}/executions`)) as Json)['totalElements'], {
        timeout: 3 * 60_000,
        intervals: [2_000],
      })
      .toBeGreaterThanOrEqual(1);
    await rail(page, 'Pages');
    await rail(page, 'Schedules');
    const recurringRow = page.locator('tbody tr', { hasText: 'Recurring generation' });
    await recurringRow.getByRole('button', { name: 'Cancel' }).click();
    await expect(recurringRow).toContainText('Cancelled');

    // ── 8. Deleting a published page: Deletion pending, online until the deletion is released ──
    await rail(page, 'Pages');
    const betaRow = page.locator('sf-page-nav-node .page-nav__row', { hasText: 'Beta' });
    const confirmText: string[] = [];
    page.once('dialog', (dialog) => confirmText.push(dialog.message()));
    await betaRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect.poll(() => confirmText[0] ?? '').toContain('It stays online until you release the deletion.');
    await expect(page.locator('sf-page-nav-node .page-nav__row', { hasText: 'Beta' })).toHaveCount(0);
    expect(await api.statuses(pageB.uuid)).toEqual({ de: 'DELETION_PENDING', en: 'DELETION_PENDING' });
    await build(page, api);
    expect(read(target.id, 'beta.html')).toContain('Beta DE');
    expect(read(target.id, 'en/beta_new.html')).toContain('Beta EN');
    await rail(page, 'Changes');
    await page.getByRole('button', { name: 'Deletion pending', exact: true }).click();
    await expect(page.locator('.changes__row')).toHaveCount(2);
    await page.getByRole('checkbox', { name: 'Select all on this page' }).check();
    await page.locator('.changes__actions').getByRole('button', { name: 'Release…', exact: true }).click();
    await page.getByRole('dialog', { name: /^Release/ }).locator('.dialog__actions').getByRole('button', { name: 'Release', exact: true }).click();
    await expect(page.locator('.changes__row')).toHaveCount(0);
    await build(page, api);
    expect(read(target.id, 'beta.html')).toBeNull();
    expect(read(target.id, 'en/beta_new.html')).toBeNull();
    expect(read(target.id, 'alpha.html')).toContain('Alpha DE');

    // ── 9. Export, then import into a new project keeping the release state ──
    await rail(page, 'Settings');
    await page.getByRole('tab', { name: 'Import / Export' }).click();
    for (const store of ['Select all pages', 'Select all media', 'Select all templates']) {
      await page.getByRole('button', { name: store }).click();
    }
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const archive = path.join(test.info().outputPath(), 'export.zip');
    await (await downloadPromise).saveAs(archive);

    const copy = await Api.signIn(COPY_KEY);
    await copy.post('/api/v1/projects', { key: COPY_KEY, name: `M27 copy ${RUN}` });
    await copy.put('/locales', locales);
    await navigate(page, `/p/${COPY_KEY}/settings/import-export`);
    await page.locator('sf-project-settings-import input[type="file"]').setInputFiles(archive);
    await expect(page.getByRole('radio', { name: /Keep release state from the archive/ })).toBeChecked({ timeout: 20_000 });
    await page.locator('sf-project-settings-import').getByRole('button', { name: 'Import', exact: true }).click();
    await expect(page.locator('.result-summary')).toContainText('Kept', { timeout: 30_000 });
    const copiedA = ((await copy.get('/pages')) as Json[]).find((p) => p['uid'] === 'alpha')!;
    expect(await copy.statuses(copiedA['uuid'])).toEqual(await api.statuses(pageA.uuid));
    expect(await copy.get('/changes/count')).toEqual(await api.get('/changes/count'));
    await copy.dispose();
    await snap(page, '09-imported');

    // ── 10. An EDITOR sees statuses and Changes, but no release or schedule actions ──
    const editor = await editorSignIn(browser, api);
    await openPage(editor, 'Alpha');
    await expect(bar(editor).locator('sf-release-badge .badge')).toBeVisible();
    await expect(bar(editor).getByRole('button', { name: /Release…|Schedule…|Unpublish…|Discard changes…/ })).toHaveCount(0);
    await rail(editor, 'Changes');
    await expect(editor.locator('.changes__row', { hasText: 'Alpha' })).toHaveCount(1);
    await expect(editor.getByRole('checkbox', { name: 'Select all on this page' })).toHaveCount(0);
    await rail(editor, 'Schedules');
    await expect(editor.getByRole('button', { name: 'New generation schedule' })).toHaveCount(0);
    await snap(editor, '10-editor');
    await editor.context().close();

    await api.dispose();
  });
});
