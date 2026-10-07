import { test, expect, request as playwrightRequest, APIRequestContext, Browser, Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cdl } from './cdl';

/**
 * M28 editor publishing journey (feature `docs-e2e`, `M28.4.2`) — a project admin opens publishing to an editor step by
 * step, in two browser contexts, every step as a user does it:
 *   1. with the policy off, the editor sees no Release, Schedule, New generation, Cancel or Promote anywhere; the
 *      generation screen says who builds;
 *   2. the admin switches on "Release" on the Generation tab; without a reload the editor's next navigation shows
 *      Release, and the editor releases a page from the Changes view — no "Build now" offered;
 *   3. the admin switches on incremental builds; the editor releases another change, presses "Build now", the run
 *      finishes "Started by" the editor with its comment; the New generation dialog has mode and target fixed, and the
 *      editor limits a run to a folder through the scope;
 *   4. the admin switches on scheduled releases; the editor schedules a release with "then generate"; it runs and the
 *      build it started is the schedule's;
 *   5. the editor schedules another release; the admin switches "Release" off — the impact dialog lists that schedule
 *      — and saves anyway; at its time the schedule fails ("Owner no longer permitted"); the admin takes it over and
 *      runs it;
 *   6. the admin opens everything incl. full builds: the editor starts a full build to the second target; Promote is
 *      still absent for the editor; the admin's audit view shows PUBLISH_POLICY_SET and GENERATION_STARTED.
 *
 * Prerequisites (as the M27 journey):
 *   - Backend on a clean database with a short scheduler poll:
 *     `SPRING_PROFILES_ACTIVE=dev SF_DB_FILE=<scratch>/db SF_OUTPUT_ROOT=<scratch>/out SF_SCHEDULER_POLL_INTERVAL=2s
 *      ./gradlew :server:sf-app:bootRun -Pfrontend.skip=true`.
 *   - UI: `SF_API_URL=http://localhost:8081 npx ng serve --proxy-config proxy.conf.mjs --port 4300`.
 *   - Run: `SF_RUN_E2E=1 SF_E2E_BASE_URL=http://localhost:4300 SF_E2E_USER=Admin SF_E2E_PASSWORD=Admin
 *     npx playwright test e2e/m28-journeys.spec.ts`.
 *
 * Self-seeding with a per-run key: the project, two targets, a template, pages (one in a folder) and the editor account
 * are created through the API; everything the journey is about happens in the UI. Waits are on observable state (the
 * UI, the API's run and schedule status), never on fixed sleeps beyond a schedule's time.
 */
const BASE_URL = process.env['SF_E2E_BASE_URL'] ?? 'http://localhost:4200';
const ADMIN_USER = process.env['SF_E2E_USER'] ?? 'Admin';
const ADMIN_PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'Admin';
const SHOTS_DIR = process.env['SF_E2E_SHOTS_DIR'];

test.use({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 }, actionTimeout: 30_000 });

const RUN = Date.now().toString(36);
const KEY = `m28e2e${RUN}`;
const PROJECT_NAME = `M28 journey ${RUN}`;
const EDITOR = `editor-e2e-${RUN}`;
const EDITOR_NAME = `Edda ${RUN}`;
const EDITOR_PASSWORD = 'm28-editor-journey-pw';

type Json = Record<string, any>;

const CDL = `content {
  editor text headline { label "Headline" required }
}`;
const HTML = '<html><body><h1>$CMS_VALUE(headline)$</h1></body></html>';

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
    const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
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

  async put(p: string, data: unknown): Promise<any> {
    const res = await this.ctx.put(this.url(p), { data });
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

  async lastRunId(): Promise<number> {
    const runs = (await this.get('/generations')) as Json[];
    return runs.reduce((max, r) => Math.max(max, r['id'] ?? 0), 0);
  }

  /** Waits until the newest run after `afterId` has finished, and returns it. */
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

  dispose(): Promise<void> {
    return this.ctx.dispose();
  }
}

async function snap(page: Page, name: string): Promise<void> {
  const file = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  if (SHOTS_DIR) {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    fs.copyFileSync(file, path.join(SHOTS_DIR, `m28-${name}.png`));
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

async function openProject(page: Page): Promise<void> {
  await page.locator('a.card', { hasText: PROJECT_NAME }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${KEY}`));
}

async function rail(page: Page, name: string): Promise<void> {
  await page.getByRole('navigation', { name: 'Project navigation' }).getByRole('link', { name: new RegExp(`^${name}`) }).click();
}

async function generationTab(page: Page): Promise<void> {
  await rail(page, 'Settings');
  await page.getByRole('tab', { name: 'Generation' }).click();
  await expect(page.getByRole('heading', { name: 'Publishing by editors' })).toBeVisible();
}

async function openPage(page: Page, name: string): Promise<void> {
  await rail(page, 'Pages');
  await page.locator('sf-page-nav-node .page-nav__name', { hasText: new RegExp(`^${name}$`) }).click();
  await expect(page.locator('sf-page-editor')).toBeVisible();
}

const bar = (page: Page) => page.locator('sf-page-editor sf-release-actions');

async function setHeadline(page: Page, text: string): Promise<void> {
  const input = page.locator('sf-page-editor sf-content-form').getByRole('textbox', { name: /Headline/ });
  await input.fill(text);
  await expect(page.locator('.page-editor__status')).toContainText('Saved', { timeout: 15_000 });
}

/** Confirms an open release dialog. */
async function confirmRelease(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: /^Release/ });
  const release = dialog.locator('.dialog__actions').getByRole('button', { name: 'Release', exact: true });
  await expect(release).toBeEnabled({ timeout: 10_000 });
  await release.click();
  await expect(dialog).toHaveCount(0);
}

/** Admin: sets the four switches of the card as given and saves, answering the impact dialog with "Save anyway". */
async function setPolicy(page: Page, on: string[], options: { expectImpact?: RegExp } = {}): Promise<void> {
  await generationTab(page);
  const card = page.locator('sf-project-settings-publish-policy');
  // In the card's order: a prerequisite is switched on before what needs it, and switching a prerequisite off switches
  // off what needs it. The click flips its own box natively at once; the card's render shows in the dependent switch
  // (enabled again, or cascaded off and disabled), so that is what each click waits for before the next is read.
  const dependent: Record<string, string> = { RELEASE: 'SCHEDULE_RELEASE', INCREMENTAL_BUILD: 'FULL_BUILD' };
  const box = (permission: string) => card.locator(`input[role="switch"][data-permission="${permission}"]`);
  for (const permission of ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD']) {
    const want = on.includes(permission);
    if ((await box(permission).isChecked()) !== want) {
      await box(permission).click();
      const next = dependent[permission];
      if (next && want) {
        await expect(box(next)).toBeEnabled();
      } else if (next) {
        await expect(box(next)).toBeDisabled();
        await expect(box(next)).not.toBeChecked();
      }
    }
  }
  for (const permission of ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD']) {
    const box = card.locator(`input[role="switch"][data-permission="${permission}"]`);
    if (on.includes(permission)) {
      await expect(box).toBeChecked();
    } else {
      await expect(box).not.toBeChecked();
    }
  }
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  if (options.expectImpact) {
    const dialog = page.getByRole('dialog', { name: 'These schedules would fail' });
    await expect(dialog).toContainText(options.expectImpact);
    await snap(page, '05-impact');
    await dialog.getByRole('button', { name: 'Save anyway' }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(card.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
}

/** Local date and time `minutes` ahead, as the schedule dialog takes them. */
async function soon(page: Page, minutes: number): Promise<{ date: string; time: string }> {
  return page.evaluate((m) => {
    const d = new Date(Date.now() + m * 60_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
  }, minutes);
}

async function scheduleRelease(page: Page, minutes: number, thenGenerate: boolean): Promise<void> {
  await bar(page).getByRole('button', { name: 'Schedule…' }).click();
  const dialog = page.getByRole('dialog', { name: /^Schedule/ });
  const when = await soon(page, minutes);
  await dialog.getByLabel('Date').fill(when.date);
  await dialog.getByLabel('Time', { exact: true }).fill(when.time);
  if (thenGenerate) {
    await dialog.getByText('Generate right after (incremental build)').click();
    // Without FULL_BUILD the build goes to the default target, shown rather than chosen.
    await expect(dialog.getByText('Default target', { exact: true })).toBeVisible();
  }
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(bar(page).locator('.ra__pending')).toContainText('Release scheduled for');
}

async function editorSignIn(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(page, EDITOR, EDITOR_PASSWORD);
  await openProject(page);
  return page;
}

test.describe('M28 editor publishing journey', () => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires a running dev backend + ng serve (SF_RUN_E2E=1)');

  test('an admin opens release, builds and schedules to an editor, step by step', async ({ page, browser }) => {
    test.setTimeout(15 * 60_000);

    // ── Seed: project, two targets, template, pages (one in a folder), a first build, the editor ──
    const api = await Api.signIn(KEY);
    await api.post('/api/v1/projects', { key: KEY, name: PROJECT_NAME });
    const template = await api.post('/page-templates', {
      displayName: 'Article',
      ...cdl(CDL),
      channelSources: { html: HTML },
    });
    const pagesRoot = (await api.get('/folders?scope=PAGES&depth=1'))[0];
    const news = await api.post('/folders', { displayName: 'News', parentFolderUuid: pagesRoot.uuid, scope: 'PAGES' });
    const home = await api.post('/pages', { displayName: 'Home', templateUuid: template.uuid });
    const about = await api.post('/pages', { displayName: 'About', templateUuid: template.uuid });
    const story = await api.post('/pages', { displayName: 'Story', templateUuid: template.uuid, folderUuid: news.uuid });
    for (const [p, text] of [
      [home, 'Home v1'],
      [about, 'About v1'],
      [story, 'Story v1'],
    ] as const) {
      await api.patchContent(p.uuid, { headline: text });
    }
    const primary = await api.post('/targets', { name: 'primary', type: 'FILESYSTEM', config: { baseUrl: 'https://example.com' }, isDefault: true });
    const second = await api.post('/targets', {
      name: 'second',
      type: 'FILESYSTEM',
      config: { baseUrl: 'https://staging.example.com' },
      isDefault: false,
    });
    expect(primary.id).toBeTruthy();
    // Home and About go online as the admin, so there are runs to (not) cancel or promote.
    await api.post('/releases', { items: [{ assetUuid: home.uuid }, { assetUuid: about.uuid }] });
    const seedRun = await api.lastRunId();
    await api.post('/generations', { mode: 'FULL' });
    await api.awaitRun(seedRun);
    const createdEditor = await api.post('/api/v1/admin/users', {
      username: EDITOR,
      email: `${EDITOR}@example.com`,
      displayName: EDITOR_NAME,
      password: EDITOR_PASSWORD,
      mustChangePassword: false,
      memberships: [{ projectKey: KEY, role: 'EDITOR' }],
    });
    expect(createdEditor.id).toBeTruthy();

    await signIn(page, ADMIN_USER, ADMIN_PASSWORD);
    await openProject(page);
    const editor = await editorSignIn(browser);

    // ── 1. Nothing opened: no publishing control anywhere for the editor ──
    await openPage(editor, 'Story');
    await expect(bar(editor).locator('sf-release-badge .badge')).toContainText('New');
    await expect(bar(editor).getByRole('button', { name: /Release…|Schedule…|Unpublish…|Discard changes…/ })).toHaveCount(0);
    await rail(editor, 'Changes');
    await editor.locator('sf-changes-list .sf-data-table__row', { hasText: 'Story' }).getByRole('checkbox').check().catch(() => undefined);
    await expect(editor.locator('sf-changes-list .sf-data-table__bulk')).toHaveCount(0);
    await generationTab(editor);
    await expect(editor.getByText('Builds are started by developers in this project.')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'New generation' })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: /^(Cancel|Promote)$/ })).toHaveCount(0);
    // The card is visible to everyone, read-only below project admin.
    await expect(editor.getByText('Only project admins can change this.')).toBeVisible();
    await snap(editor, '01-editor-nothing');

    // ── 2. Release on: the editor's next navigation shows it; release from the Changes view, no Build now ──
    await setPolicy(page, ['RELEASE']);
    await snap(page, '02-admin-release-on');
    await rail(editor, 'Changes');
    const storyRow = editor.locator('sf-changes-list .sf-data-table__row', { hasText: 'Story' });
    await storyRow.getByRole('checkbox').check();
    await editor.locator('sf-changes-list .sf-data-table__bulk').getByRole('button', { name: 'Release…', exact: true }).click();
    await confirmRelease(editor);
    await expect(editor.locator('sf-changes-list .sf-data-table__row', { hasText: 'Story' })).toHaveCount(0);
    await expect(editor.locator('sf-toast-host .toast--success').first()).toBeVisible();
    await expect(editor.locator('sf-toast-host').getByRole('button', { name: 'Build now' })).toHaveCount(0);
    await expect(editor.locator('sf-changes-list .sf-data-table__bulk').getByRole('button', { name: 'Schedule…' })).toHaveCount(0);

    // ── 3. Incremental builds on: Build now after a release; the run is the editor's; the dialog is restricted ──
    await setPolicy(page, ['RELEASE', 'INCREMENTAL_BUILD']);
    await openPage(editor, 'About');
    await setHeadline(editor, 'About v2');
    await bar(editor).getByRole('button', { name: 'Release…' }).click();
    await confirmRelease(editor);
    const beforeBuild = await api.lastRunId();
    await editor.locator('sf-toast-host').getByRole('button', { name: 'Build now' }).click();
    const built = await api.awaitRun(beforeBuild);
    expect(built['startedBy']['displayName']).toBe(EDITOR_NAME);
    expect(built['comment']).toBe('Build after release');
    await editor.locator('sf-toast-host').getByRole('button', { name: 'Show progress' }).click();
    const builtRow = editor.locator('tbody tr', { hasText: `#${built['id']}` });
    await expect(builtRow).toContainText(`Started by ${EDITOR_NAME}`);
    await expect(builtRow).toContainText('Build after release');
    // Toasts go away on their own: step 2's release note is long gone.
    await expect(editor.locator('sf-toast-host .toast', { hasText: 'goes online with the next build.' })).toHaveCount(0, {
      timeout: 10_000,
    });
    await snap(editor, '03-editor-built');
    // The editor's own finished run: no Promote; a new run is incremental to the default target only.
    await expect(editor.getByRole('button', { name: 'Promote' })).toHaveCount(0);
    // Two released changes, one of them in News: a run limited to News rebuilds that page only.
    await api.patchContent(story.uuid, { headline: 'Story v2' });
    await api.patchContent(home.uuid, { headline: 'Home v1b' });
    await api.post('/releases', { items: [{ assetUuid: story.uuid }, { assetUuid: home.uuid }] });
    await editor.getByRole('button', { name: 'New generation' }).click();
    const dialog = editor.getByRole('dialog', { name: 'New generation' });
    await expect(dialog.locator('input[type="radio"][value="FULL"]')).toHaveCount(0);
    await expect(dialog.locator('.fixed')).toContainText('Incremental');
    await expect(dialog.locator('.fixed')).toContainText('primary');
    await dialog.getByLabel('Limit to folder').selectOption({ label: 'News' });
    await dialog.getByRole('button', { name: /Preview plan/ }).click();
    await expect(dialog.locator('.preview__counts')).toContainText('1 page ·');
    await snap(editor, '03-editor-scoped-dialog');
    const beforeScoped = await api.lastRunId();
    await dialog.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const scoped = await api.awaitRun(beforeScoped);
    expect(scoped['mode']).toBe('INCREMENTAL');
    expect(scoped['planSummary']['scoped']).toBe(true);
    expect(scoped['planSummary']['pageCount']).toBe(1);

    // ── 4. Scheduled releases on: a release with "then generate" runs and starts the editor's build ──
    await setPolicy(page, ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD']);
    await openPage(editor, 'Home');
    await setHeadline(editor, 'Home v2');
    await scheduleRelease(editor, 2, true);
    const firstSchedule = ((await api.get('/schedules?type=RELEASE')) as Json)['rows'][0]['id'] as number;
    const beforeScheduled = await api.lastRunId();
    await expect
      .poll(async () => (await api.get(`/schedules/${firstSchedule}`))['status'], { timeout: 4 * 60_000, intervals: [2_000] })
      .toBe('SUCCEEDED');
    const scheduledRun = await api.awaitRun(beforeScheduled);
    expect(scheduledRun['comment']).toBe(`After scheduled release #${firstSchedule}`);
    expect(scheduledRun['startedBy']['displayName']).toBe(EDITOR_NAME);

    // ── 5. A pending schedule fails once Release is off: the admin was warned, takes it over and runs it ──
    await setHeadline(editor, 'Home v3');
    await scheduleRelease(editor, 2, false);
    const rows = ((await api.get('/schedules?type=RELEASE&status=PENDING')) as Json)['rows'] as Json[];
    const secondSchedule = rows[0]['id'] as number;
    await setPolicy(page, ['INCREMENTAL_BUILD'], { expectImpact: new RegExp(EDITOR_NAME) });
    await expect
      .poll(async () => (await api.get(`/schedules/${secondSchedule}`))['status'], { timeout: 4 * 60_000, intervals: [2_000] })
      .toBe('FAILED');
    await rail(page, 'Schedules');
    await page.getByRole('button', { name: 'Status' }).click();
    await page.getByRole('menuitem', { name: 'Failed or paused' }).click();
    const failedRow = page.locator('sf-schedules .sf-data-table__row', { hasText: EDITOR_NAME }).filter({ hasText: /Failed/ });
    await expect(failedRow.first()).toBeVisible();
    await failedRow.first().getByRole('button', { name: /^Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'History' }).click();
    const history = page.getByRole('dialog', { name: /^History/ });
    await expect(history).toContainText('Owner no longer permitted');
    await snap(page, '05-failed-history');
    await history.getByRole('button', { name: 'Close' }).click();
    await failedRow.first().getByRole('button', { name: /^Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Take over' }).click();
    await expect
      .poll(async () => (await api.get(`/schedules/${secondSchedule}`))['status'], { timeout: 60_000, intervals: [1_000] })
      .toBe('SUCCEEDED');
    // The taken-over release put "Home v3" online.
    const homeRelease = Object.values((await api.get(`/pages/${home.uuid}`))['release'] as Json);
    expect(homeRelease.map((r) => r['status'])).toEqual(['PUBLISHED']);

    // ── 6. Everything on: a full build to the second target; Promote stays with developers; the audit shows it ──
    await setPolicy(page, ['RELEASE', 'SCHEDULE_RELEASE', 'INCREMENTAL_BUILD', 'FULL_BUILD']);
    await generationTab(editor);
    await editor.getByRole('button', { name: 'New generation' }).click();
    const full = editor.getByRole('dialog', { name: 'New generation' });
    await full.locator('input[type="radio"][value="FULL"]').check();
    await full.getByRole('combobox', { name: 'Target' }).selectOption({ label: 'second' });
    const beforeFull = await api.lastRunId();
    await full.getByRole('button', { name: 'Start', exact: true }).click();
    await expect(full).toHaveCount(0);
    const fullRun = await api.awaitRun(beforeFull);
    expect(fullRun['mode']).toBe('FULL');
    expect(fullRun['targetId']).toBe(second.id);
    await expect(editor.locator('tbody tr', { hasText: `#${fullRun['id']}` })).toContainText('SUCCESS', { timeout: 30_000 });
    await expect(editor.getByRole('button', { name: 'Promote' })).toHaveCount(0);
    await snap(editor, '06-editor-full-build');

    await page.getByRole('button', { name: /Account menu/ }).click();
    await page.getByRole('menuitem', { name: /Administration/ }).click();
    await page.getByRole('navigation', { name: 'Administration' }).getByRole('link', { name: 'Audit' }).click();
    await page.getByLabel('Actions').selectOption(['PUBLISH_POLICY_SET', 'GENERATION_STARTED']);
    await expect(page).toHaveURL(/action=PUBLISH_POLICY_SET/);
    const audit = page.locator('tbody tr');
    await expect(audit.filter({ hasText: 'PUBLISH_POLICY_SET' }).filter({ hasText: `project:${KEY}` }).first()).toBeVisible();
    await expect(audit.filter({ hasText: 'GENERATION_STARTED' }).filter({ hasText: EDITOR }).first()).toBeVisible();
    await snap(page, '06-audit');

    await editor.context().close();
    await api.dispose();
  });
});
