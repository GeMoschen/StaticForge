import { test, expect, request as playwrightRequest, APIRequestContext, Browser, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';

/**
 * M29 housekeeping journey (feature `docs-e2e`, `M29.6.2`) — an instance admin looks after the instance, every step as
 * a user does it:
 *   1. Administration → Jobs lists every job with its next run; the admin sets the blob sweep's grace to 1 hour and
 *      saves: the history is unchanged and the next run is shown;
 *   2. in a fresh project the admin uploads two files, replaces the first and deletes the second; a blob-sweep dry run
 *      reports every blob as marked (history still references the old and the deleted file) and removes nothing, and
 *      a real run reports the same counts;
 *   3. a developer starts a full build of a large site; the admin cancels it from the generation page while it runs:
 *      it ends CANCELLED, no new published build appears in the run list, and the developer's next build starts;
 *   4. the project admin enables compaction (older than 30 days, estimate shown, project key typed); after the admin
 *      runs `revision-compaction` from the Jobs page the card shows "Compacted through";
 *   5. time travel to a compacted revision shows the compacted banner, and its diff the compacted message;
 *   6. the audit view filtered by JOB_RUN and COMPACTION_POLICY_SET shows the entries.
 *
 * Prerequisites (like the M28 journey; the backend runs in the `dev` profile, which has the fixture endpoint used to
 * back-date history — revision compaction only touches history older than 30 days):
 *   - Backend on a clean database and blob store:
 *     `SPRING_PROFILES_ACTIVE=dev SF_DB_FILE=<scratch>/db SF_OUTPUT_ROOT=<scratch>/out SF_MEDIA_ROOT=<scratch>/media
 *      SF_SEARCH_INDEX_ROOT=<scratch>/index ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *     A separate `SF_MEDIA_ROOT` matters: the journey runs a real blob sweep over the whole store.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m29-journeys.spec.ts`. With `SF_E2E_MEDIA_ROOT` (= the backend's `SF_MEDIA_ROOT`) the
 *     journey also checks the swept store still holds the replaced and the deleted file's bytes.
 *
 * Self-seeding with a per-run key: two projects (a small one with history, a large one to build), a developer account,
 * pages and targets are created through the API, and the small project's first revisions are back-dated by 40 days
 * through `POST /api/v1/dev/fixtures/projects/{key}/backdate-revisions` (dev/test profiles only). Everything the
 * journey is about — job settings, runs, uploads, cancel, compaction, time travel, audit — happens in the UI.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const ADMIN_USER = process.env['SF_E2E_USER'] ?? 'Admin';
const ADMIN_PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'Admin';
const MEDIA_ROOT = process.env['SF_E2E_MEDIA_ROOT'];
const SHOTS_DIR = process.env['SF_E2E_SHOTS_DIR'];

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 }, actionTimeout: 30_000 });

const RUN = Date.now().toString(36);
const KEY = `m29e2e${RUN}`;
const PROJECT_NAME = `M29 journey ${RUN}`;
const BIG_KEY = `m29big${RUN}`;
const BIG_NAME = `M29 large site ${RUN}`;
const DEVELOPER = `m29dev${RUN}`;
const DEVELOPER_NAME = `Dev ${RUN}`;
const DEVELOPER_PASSWORD = 'm29-developer-journey-pw';
/** Pages of the large site and the size of its template: together a full build takes several seconds. */
const BIG_PAGES = 400;
const TEMPLATE_WEIGHT = 80_000;

const JOB_KEYS = [
  'generation-run-recovery',
  'build-output-cleanup',
  'blob-sweep',
  'audit-purge',
  'refresh-token-cleanup',
  'memory-eviction',
  'generation-run-retention',
  'media-variant-backfill',
  'search-maintenance',
  'revision-compaction',
];

type Json = Record<string, any>;

const CDL = `content {
  editor text headline { label "Headline" }
}`;
const LIGHT_HTML = '<html><body><h1>$CMS_VALUE(headline)$</h1></body></html>';

/** A 1×1 PNG of one colour, so each file has its own bytes (and blob). */
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

/** Per-run colours: a second run of the journey uploads new bytes, not blobs the first run left behind. */
const seed = parseInt(RUN.slice(-4), 36);
const FIRST_PNG = png([seed % 256, 10, 20]);
const REPLACEMENT_PNG = png([seed % 256, 120, 30]);
const SECOND_PNG = png([seed % 256, 30, 220]);

class Api {
  private constructor(
    private readonly ctx: APIRequestContext,
    readonly projectKey: string,
  ) {}

  static async signIn(projectKey: string): Promise<Api> {
    const anon = await playwrightRequest.newContext({ baseURL: BASE_URL });
    const login = await anon.post('/api/v1/auth/login', { data: { username: ADMIN_USER, password: ADMIN_PASSWORD } });
    expect(login.ok(), await login.text()).toBeTruthy();
    const token = (await login.json()).accessToken as string;
    await anon.dispose();
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
    return new Api(ctx, projectKey);
  }

  forProject(projectKey: string): Api {
    return new Api(this.ctx, projectKey);
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

  async patchContent(pageUuid: string, content: Json): Promise<number> {
    const current = await this.get(`/pages/${pageUuid}`);
    const res = await this.ctx.patch(this.url(`/pages/${pageUuid}/content`), {
      data: { content },
      headers: { 'If-Match': `"rev-${current.revision}"`, 'Content-Type': 'application/merge-patch+json' },
    });
    expect(res.ok(), `patch → ${res.status()} ${await res.text()}`).toBeTruthy();
    return (await this.get(`/pages/${pageUuid}`)).revision as number;
  }

  async setTemplateSource(templateUuid: string, source: string): Promise<void> {
    const current = await this.ctx.get(this.url(`/page-templates/${templateUuid}`));
    expect(current.ok()).toBeTruthy();
    const res = await this.ctx.put(this.url(`/page-templates/${templateUuid}/channels/html`), {
      data: { source },
      headers: { 'If-Match': current.headers()['etag'] },
    });
    expect(res.ok(), `template → ${res.status()} ${await res.text()}`).toBeTruthy();
  }

  /**
   * The blobs of every media version the project's history created, as the server stored them (it may re-encode an
   * upload, so hashing the uploaded bytes is not enough): a read of each version a MEDIA create or update wrote.
   */
  async mediaBlobShas(): Promise<string[]> {
    const shas: string[] = [];
    for (const revision of (await this.get('/revisions')) as Json[]) {
      for (const asset of (revision['summary']?.['assets'] ?? []) as Json[]) {
        if (asset['type'] === 'MEDIA' && asset['action'] !== 'DELETE') {
          const version = await this.get(`/assets/${asset['uuid']}/versions/${revision['revisionId']}`);
          shas.push(version['payload']['blobSha256']);
        }
      }
    }
    return shas;
  }

  async runs(): Promise<Json[]> {
    return (await this.get('/generations')) as Json[];
  }

  async awaitRun(id: number, status: RegExp): Promise<Json> {
    let run: Json | null = null;
    await expect
      .poll(
        async () => {
          run = await this.get(`/generations/${id}`);
          return ['QUEUED', 'RUNNING'].includes(run!['status']) ? 'pending' : run!['status'];
        },
        { timeout: 120_000, intervals: [500] },
      )
      .toMatch(status);
    return run!;
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
    fs.copyFileSync(file, path.join(SHOTS_DIR, `m29-${name}.png`));
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

/** Back to the project list: the admin area's "Projects" link, else the address bar (the project shell has no link). */
async function home(page: Page): Promise<void> {
  const back = page.locator('a.admin__back');
  if (await back.isVisible()) {
    await back.click();
  } else {
    await page.evaluate(() => {
      history.pushState(null, '', '/');
      dispatchEvent(new PopStateEvent('popstate'));
    });
  }
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('a.card').first()).toBeVisible();
}

async function openProject(page: Page, name: string, key: string): Promise<void> {
  await page.locator('a.card', { hasText: name }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${key}`));
}

async function rail(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

async function generationTab(page: Page): Promise<void> {
  await rail(page, 'Settings');
  await page.getByRole('tab', { name: 'Generation' }).click();
  await expect(page.getByRole('heading', { name: 'Publishing by editors' })).toBeVisible();
}

async function administration(page: Page, tab: 'Jobs' | 'Audit'): Promise<void> {
  await page.getByRole('button', { name: /Account menu/ }).click();
  await page.getByRole('menuitem', { name: /Administration/ }).click();
  await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: tab }).click();
}

/** From anywhere: Administration → Jobs → the job's detail page. */
async function openJob(page: Page, key: string): Promise<void> {
  await administration(page, 'Jobs');
  await page.locator(`tr[data-job="${key}"]`).getByRole('link').first().click();
  await expect(page.locator('.head__title')).toBeVisible();
  await expect(page.locator('.head .mono')).toHaveText(key);
}

interface RunReport {
  examined: string;
  affected: string;
  extras: Json;
}

/** Presses Run now / Dry run on the open job page and waits for the finished report. */
async function runJob(page: Page, dryRun: boolean): Promise<RunReport> {
  await page.getByRole('group', { name: 'Run the job' }).getByRole('button', { name: dryRun ? 'Dry run' : 'Run now' }).click();
  const current = page.locator('.current');
  await expect(current.locator('.current__title')).toHaveText(new RegExp(`^${dryRun ? 'Dry run' : 'Run'} finished`), { timeout: 120_000 });
  const report = current.locator('sf-admin-job-run-report');
  await expect(report.locator('.report__head')).toContainText(/Succeeded/);
  const count = (label: string) => report.locator('.report__counts div', { has: page.locator(`dt:text-is("${label}")`) }).locator('dd');
  const examined = (await count('Examined').textContent())!.trim();
  const affected = (await count(dryRun ? 'Would affect' : 'Affected').textContent())!.trim();
  let extras: Json = {};
  const details = report.locator('.report__extras');
  if (await details.count()) {
    await details.locator('summary').click();
    extras = JSON.parse((await details.locator('pre').textContent()) ?? '{}');
  }
  return { examined, affected, extras };
}

async function developerSignIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(page, DEVELOPER, DEVELOPER_PASSWORD);
  await openProject(page, BIG_NAME, BIG_KEY);
  return page;
}

/** The developer starts a full build from the generation page and returns its run id. */
async function startFullBuild(page: Page): Promise<number> {
  await generationTab(page);
  await page.getByRole('button', { name: 'New generation' }).click();
  const dialog = page.getByRole('dialog', { name: 'New generation' });
  await dialog.locator('input[type="radio"][value="FULL"]').check();
  const started = page.waitForResponse((r) => r.request().method() === 'POST' && /\/generations$/.test(r.url()));
  await dialog.getByRole('button', { name: 'Start', exact: true }).click();
  const response = await started;
  expect(response.status(), await response.text()).toBeLessThan(300);
  await expect(dialog).toHaveCount(0);
  return (await response.json())['id'] as number;
}

test.describe('M29 housekeeping journey', () => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');

  test('an admin tunes and runs housekeeping jobs, cancels a build and compacts old history', async ({ page, browser }) => {
    test.setTimeout(15 * 60_000);

    // ── Seed A: a small project whose page has three edits 40 days ago and one today ──
    const api = await Api.signIn(KEY);
    await api.post('/api/v1/projects', { key: KEY, name: PROJECT_NAME });
    const template = await api.post('/page-templates', { displayName: 'Article', contentDefinition: CDL, channelSources: { html: LIGHT_HTML } });
    const story = await api.post('/pages', { displayName: 'Story', templateUuid: template.uuid });
    const firstEdit = await api.patchContent(story.uuid, { headline: 'Morning draft' });
    await api.patchContent(story.uuid, { headline: 'Noon draft' });
    const lastOldEdit = await api.patchContent(story.uuid, { headline: 'Evening version' });
    const backdated = await api.post(`/api/v1/dev/fixtures/projects/${KEY}/backdate-revisions`, { days: 40, throughRevision: lastOldEdit });
    expect(backdated.revisionsShifted).toBe(lastOldEdit);
    await api.patchContent(story.uuid, { headline: 'Today' });

    // ── Seed B: a large site with a first published build, and a developer ──
    const big = api.forProject(BIG_KEY);
    await big.post('/api/v1/projects', { key: BIG_KEY, name: BIG_NAME });
    const bigTemplate = await big.post('/page-templates', { displayName: 'Heavy', contentDefinition: CDL, channelSources: { html: LIGHT_HTML } });
    const bigPages: string[] = [];
    for (let i = 0; i < BIG_PAGES; i++) {
      bigPages.push((await big.post('/pages', { displayName: `Page ${i}`, templateUuid: bigTemplate.uuid })).uuid);
    }
    // A template with many (cheap, output-free) conditionals makes every page take a few milliseconds to render.
    await big.setTemplateSource(bigTemplate.uuid, `<html><body>${'$CMS_IF(headline)$x$CMS_END_IF$'.repeat(TEMPLATE_WEIGHT)}</body></html>`);
    await big.post('/targets', { name: 'primary', type: 'FILESYSTEM', config: { baseUrl: 'https://example.com' }, isDefault: true });
    await big.post('/releases', { items: bigPages.map((uuid) => ({ assetUuid: uuid })) });
    const seedRun = (await big.post('/generations', { mode: 'FULL' }))['id'] as number;
    await big.awaitRun(seedRun, /SUCCESS/);
    await api.post('/api/v1/admin/users', {
      username: DEVELOPER,
      email: `${DEVELOPER}@example.com`,
      displayName: DEVELOPER_NAME,
      password: DEVELOPER_PASSWORD,
      mustChangePassword: false,
      memberships: [{ projectKey: BIG_KEY, role: 'DEVELOPER' }],
    });

    await signIn(page, ADMIN_USER, ADMIN_PASSWORD);

    // ── 1. Jobs page: every job with its next run; blob-sweep grace → 1 hour ──
    await administration(page, 'Jobs');
    for (const key of JOB_KEYS) {
      const row = page.locator(`tr[data-job="${key}"]`);
      await expect(row).toBeVisible();
      await expect(row.locator('td').nth(3)).not.toHaveText(/^\s*(—|Disabled)?\s*$/);
    }
    await snap(page, '01-jobs');
    await page.locator('tr[data-job="blob-sweep"]').getByRole('link').first().click();
    await expect(page.locator('.head .mono')).toHaveText('blob-sweep');
    const history = page.locator('section[aria-labelledby="job-history-title"] tbody tr[data-run]');
    await expect(page.locator('section[aria-labelledby="job-history-title"] table')).toBeVisible();
    const historyBefore = await history.count();
    const grace = page.locator('input[data-setting="graceHours"]');
    // A second run of the journey on the same instance finds the 1 hour of the first: back to the defaults first.
    await page.getByRole('button', { name: 'Reset to defaults' }).click();
    await expect(page.locator('sf-toast-host .toast--success', { hasText: 'Reset to the defaults.' })).toBeVisible();
    await expect(grace).toHaveValue('24');
    await grace.fill('1');
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(page.locator('sf-toast-host .toast--success', { hasText: /^Saved\. Next run:/ })).toBeVisible();
    await expect(save).toBeDisabled();
    await expect(grace).toHaveValue('1');
    await expect(page.locator('.facts')).toContainText(/Next run\s*\w+, \d+/);
    await expect(history).toHaveCount(historyBefore);
    await snap(page, '01-blob-sweep-saved');

    // ── 2. Upload two files, replace the first, delete the second; dry run and real run of the blob sweep ──
    await home(page);
    await openProject(page, PROJECT_NAME, KEY);
    await rail(page, 'Media');
    const library = page.locator('sf-media-library');
    const chooser = page.waitForEvent('filechooser');
    await library.getByRole('button', { name: 'Upload', exact: true }).click();
    await (await chooser).setFiles([
      { name: `first-${RUN}.png`, mimeType: 'image/png', buffer: FIRST_PNG },
      { name: `second-${RUN}.png`, mimeType: 'image/png', buffer: SECOND_PNG },
    ]);
    await expect(library.getByText(`first-${RUN}.png`).first()).toBeVisible({ timeout: 20_000 });
    await expect(library.getByText(`second-${RUN}.png`).first()).toBeVisible({ timeout: 20_000 });
    const mediaCard = (name: string) => library.locator('.grid').getByRole('button', { name: new RegExp(`^${name.replace('.', '\\.')} `) });

    await mediaCard(`first-${RUN}.png`).click();
    const drawer = page.locator('sf-media-detail-drawer');
    await drawer.getByLabel('Replace file').setInputFiles({ name: `first-${RUN}-v2.png`, mimeType: 'image/png', buffer: REPLACEMENT_PNG });
    await expect(page.locator('sf-toast-host .toast--success', { hasText: 'Media replaced' })).toBeVisible();
    await drawer.getByRole('button', { name: 'Close' }).first().click();
    await expect(drawer).toHaveCount(0);

    await mediaCard(`second-${RUN}.png`).click();
    await drawer.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('dialog', { name: 'Delete media' });
    await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.locator('sf-toast-host .toast--success', { hasText: 'Media deleted' })).toBeVisible();
    await expect(mediaCard(`second-${RUN}.png`)).toHaveCount(0);
    await snap(page, '02-media');

    // The original, the replacement and the deleted file: three blobs, two of them referenced only by history.
    const uploaded = await api.mediaBlobShas();
    expect(new Set(uploaded).size).toBe(3);

    await openJob(page, 'blob-sweep');
    const dry = await runJob(page, true);
    await snap(page, '02-blob-sweep-dry-run');
    // Nothing is collectable: the replaced and the deleted file are still referenced by history, the rest is current.
    expect(dry.affected).toBe('0');
    expect(Number(dry.extras['marked'])).toBeGreaterThanOrEqual(3);
    expect(dry.extras['rowsDeleted'] ?? 0).toBe(0);
    for (const sha of uploaded) {
      await expect(page.locator('.current')).not.toContainText(sha);
    }
    const real = await runJob(page, false);
    await snap(page, '02-blob-sweep-run');
    expect(real.examined).toBe(dry.examined);
    expect(real.affected).toBe(dry.affected);
    expect(real.extras['marked']).toBe(dry.extras['marked']);
    // Both runs are on top of the history: the real run, then the dry run, each started by the admin.
    for (const [row, dryRunCell] of [[0, 'No'], [1, 'Yes']] as const) {
      const cells = history.nth(row).locator('td');
      await expect(cells.nth(1)).toHaveText('Manual');
      await expect(cells.nth(2)).toHaveText(dryRunCell);
      await expect(cells.nth(7)).toHaveText(ADMIN_USER);
    }
    if (MEDIA_ROOT) {
      const stored = (sha: string) =>
        fs.readdirSync(MEDIA_ROOT, { recursive: true, encoding: 'utf8' }).some((f) => path.basename(f).startsWith(sha));
      for (const sha of uploaded) {
        expect(stored(sha), `blob ${sha} kept`).toBeTruthy();
      }
    }

    // ── 3. The developer starts a full build; the admin cancels it while it runs; the next build starts ──
    const developer = await developerSignIn(browser);
    const cancelledId = await startFullBuild(developer);
    await home(page);
    await openProject(page, BIG_NAME, BIG_KEY);
    await generationTab(page);
    const runRow = (id: number) => page.locator('tbody tr', { has: page.locator(`td.num:text-is("#${id}")`) });
    await expect(runRow(cancelledId).locator('.badge')).toHaveText(/RUNNING|QUEUED/);
    await snap(page, '03-running');
    await runRow(cancelledId).getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(runRow(cancelledId).locator('.badge')).toHaveText('CANCELLED', { timeout: 30_000 });
    // The site's current build is still the seed build: no run after it was published.
    const published = (await big.runs()).filter((r) => ['SUCCESS', 'PARTIAL'].includes(r['status'])).map((r) => r['id']);
    expect(published).toEqual([seedRun]);
    await expect(page.locator('tbody tr .badge', { hasText: /SUCCESS|PARTIAL/ })).toHaveCount(1);
    await expect(runRow(seedRun).locator('.badge')).toHaveText('SUCCESS');
    const cancelled = await big.awaitRun(cancelledId, /CANCELLED/);
    expect(cancelled['filesWritten'] ?? 0).toBeLessThan(BIG_PAGES);
    await snap(page, '03-cancelled');
    const secondId = await startFullBuild(developer);
    expect(secondId).toBeGreaterThan(cancelledId);
    await big.awaitRun(secondId, /SUCCESS/);
    await developer.context().close();

    // ── 4. Compaction: the project admin enables it (30 days); the admin runs the job; "Compacted through" ──
    await home(page);
    await openProject(page, PROJECT_NAME, KEY);
    await rail(page, 'Settings');
    const card = page.locator('sf-project-settings-compaction');
    await expect(card.getByTestId('compaction-status')).toHaveText(/Off/);
    await expect(card.locator('.compaction__facts').first()).toContainText('nothing compacted yet');
    const days = card.getByLabel('Older than (days)');
    await days.fill('29');
    await expect(card.getByText('Enter a whole number of days, at least 30.')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Enable compaction…' })).toBeDisabled();
    await days.fill('30');
    await card.getByRole('button', { name: 'Enable compaction…' }).click();
    const confirm = page.getByRole('dialog', { name: 'Enable compaction?' });
    await expect(confirm.getByTestId('compaction-estimate')).toContainText('3 versions removed');
    const enable = confirm.getByRole('button', { name: 'Enable compaction', exact: true });
    await confirm.getByLabel(`Type ${KEY} to confirm`).fill(KEY.slice(0, -1));
    await expect(enable).toBeDisabled();
    await confirm.getByLabel(`Type ${KEY} to confirm`).fill(KEY);
    await snap(page, '04-enable-compaction');
    await enable.click();
    await expect(confirm).toHaveCount(0);
    await expect(card.getByTestId('compaction-status')).toContainText('On — older than 30 days');

    await openJob(page, 'revision-compaction');
    const compaction = await runJob(page, false);
    expect(Number(compaction.affected)).toBeGreaterThanOrEqual(3);
    await expect(page.locator('.current')).toContainText(`${KEY}:`);
    await snap(page, '04-compaction-run');

    await home(page);
    await openProject(page, PROJECT_NAME, KEY);
    await rail(page, 'Settings');
    await expect(card.locator('.compaction__facts').first()).toContainText(`revision ${lastOldEdit}`);
    await expect(card.getByTestId('compaction-last-run')).toContainText('3 versions removed');
    await snap(page, '04-compacted-through');

    // ── 5. Time travel to a compacted revision: banner and diff say so ──
    const tick = page.locator('sf-revision-spine').getByRole('button', { name: new RegExp(`^Revision ${firstEdit} ·`) });
    await expect(tick.getByTestId('spine-compacted')).toBeVisible();
    await tick.click();
    const banner = page.locator('.shell__timemachine');
    await expect(banner).toContainText(`Viewing revision ${firstEdit}`);
    await expect(banner).toContainText('Compacted history: you see the state at the end of that day');
    await expect(page.getByTestId('diff-compacted')).toContainText(
      'Exact changes of this revision were compacted; the state at the end of the day is kept',
    );
    await snap(page, '05-time-travel-compacted');
    await page.getByRole('button', { name: 'Back to now' }).click();
    await expect(banner).toHaveCount(0);

    // ── 6. Audit: JOB_RUN and COMPACTION_POLICY_SET ──
    await administration(page, 'Audit');
    await page.getByLabel('Actions').selectOption(['JOB_RUN', 'COMPACTION_POLICY_SET']);
    await expect(page).toHaveURL(/action=JOB_RUN/);
    // The options ("CODE — label") fit their list instead of being cut off.
    expect(await page.getByLabel('Actions', { exact: true }).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const audit = page.locator('tbody tr');
    await expect(audit.filter({ hasText: 'COMPACTION_POLICY_SET' }).filter({ hasText: `project:${KEY}` }).first()).toBeVisible();
    await expect(audit.filter({ hasText: 'JOB_RUN' }).filter({ hasText: 'blob-sweep' }).first()).toBeVisible();
    await expect(audit.filter({ hasText: 'JOB_RUN' }).filter({ hasText: 'revision-compaction' }).first()).toBeVisible();
    await snap(page, '06-audit');

    // At phone width the admin pages don't scroll sideways: wide tables scroll inside their frame, panels fit.
    await page.setViewportSize({ width: 390, height: 800 });
    const noSideScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    await expect.poll(noSideScroll).toBe(true);
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Jobs' }).click();
    await page.locator('tr[data-job="blob-sweep"]').getByRole('link').first().click();
    await expect(page.locator('section[aria-labelledby="job-history-title"] tbody tr[data-run]').first()).toBeVisible();
    await expect.poll(noSideScroll).toBe(true);
    const settingsPanel = (await page.locator('section[aria-labelledby="job-settings-title"]').boundingBox())!;
    expect(settingsPanel.x + settingsPanel.width).toBeLessThanOrEqual(390 - 16);
    await snap(page, '06-job-detail-phone');

    await api.dispose();
  });
});
