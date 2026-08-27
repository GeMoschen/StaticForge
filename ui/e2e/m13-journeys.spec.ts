import { test, expect, Page } from '@playwright/test';

/**
 * M13 closing journey (feature `verification`, `M13.4.3`, §10.2/§12/§13): exercises the
 * Templates screen's new folder tree (create a subfolder under the fixed "Page Templates"
 * root, create a template inside it, move the template to a second folder via cut/paste)
 * and the export/import panel's fourth "Templates" tree scope (expand the tree, check a
 * template folder, confirm the checkbox/ancestor-implicit state the same way the existing
 * Pages/Media/Navigation tree sections already assert for themselves).
 *
 * Prerequisites (not yet provisioned — see `ui/e2e/README.md`), mirroring m3/m5/m6/m7/m8:
 *   - Backend running (Spring Boot, `demo` profile) with a seeded demo user/project (every
 *     project already has the two fixed "Page Templates"/"Section Templates" folders
 *     auto-provisioned server-side — `AssetService.ensureTemplateFolders` — so no template
 *     seed data is required beyond that).
 *   - `npm start` (ng serve) on http://localhost:4200 proxying /api to the backend.
 * The demo seed is still deferred, so — exactly like m5/m6/m7/m8 — this spec is gated on
 * `SF_RUN_E2E` and documents the intended flow rather than having been run against a live
 * browser here. The actual proof for this milestone's backend behavior is
 * `TemplateFolderIntegrationTest` and `ProjectExportImportIntegrationTest` (`server/sf-app`),
 * `@SpringBootTest`s that exercise the identical scenarios end-to-end via real service calls.
 */
const USER = process.env['SF_E2E_USER'] ?? 'demo';
const PASSWORD = process.env['SF_E2E_PASSWORD'] ?? 'demo';

const PROJECT_KEY = 'demo';

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('sf-login input[name="username"]').fill(USER);
  await page.locator('sf-login input[name="password"]').fill(PASSWORD);
  await page.locator('sf-login button[type="submit"]').click();
  await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
}

/** Fills and submits the shared `sf-create-asset-dialog` (folder or template creation) —
 * only one instance is ever rendered in the DOM at a time since each node's `open()` input
 * gates the whole `.dialog`, mirroring how m8's spec locates `sf-nav-folder-detail` fields. */
async function submitCreateDialog(page: Page, name: string): Promise<void> {
  const dialog = page.locator('.dialog[role="dialog"]');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="text"]').first().fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(dialog).toBeHidden();
}

test('journey: templates folder tree — create folder, create template, move via cut/paste', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);

  await page.goto(`/p/${PROJECT_KEY}/templates`);
  await expect(page.locator('sf-templates')).toBeVisible();

  // The two fixed, protected roots are always present — no "New root folder" affordance
  // exists for them (M13.1.2's closed top level).
  const pageTemplatesRoot = page.locator('.folder-node__row', { hasText: 'Page Templates' }).first();
  await expect(pageTemplatesRoot).toBeVisible();
  await expect(pageTemplatesRoot.locator('.folder-node__protected-icon')).toBeVisible();

  // 1. Create a subfolder under "Page Templates" via its context menu.
  await pageTemplatesRoot.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New subfolder' }).click();
  await submitCreateDialog(page, 'E2E Landing');
  const landingFolder = page.locator('.folder-node__row', { hasText: 'E2E Landing' }).first();
  await expect(landingFolder).toBeVisible();

  // 2. Create a second, sibling subfolder — the move target.
  await pageTemplatesRoot.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'New subfolder' }).click();
  await submitCreateDialog(page, 'E2E Archive');
  const archiveFolder = page.locator('.folder-node__row', { hasText: 'E2E Archive' }).first();
  await expect(archiveFolder).toBeVisible();

  // 3. Select "E2E Landing" and create a template inside it.
  await landingFolder.click();
  await page.getByRole('button', { name: 'New' }).click();
  await submitCreateDialog(page, 'E2E Landing Template');
  const templateRow = page.locator('.templates__row', { hasText: 'E2E Landing Template' });
  await expect(templateRow).toBeVisible();

  // 4. Move the template into "E2E Archive" via cut/paste (drag-and-drop isn't scriptable
  // reliably with native HTML5 DnD events, so this exercises the same underlying
  // `AssetController` move endpoint through the cut/paste UI instead).
  await templateRow.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Cut' }).click();
  await archiveFolder.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste' }).click();
  await expect(page.getByText('Moved "E2E Landing Template"')).toBeVisible();

  // 5. Confirm the move: "E2E Landing" is now empty, "E2E Archive" holds the template.
  await landingFolder.click();
  await expect(page.locator('.templates__row', { hasText: 'E2E Landing Template' })).toHaveCount(0);
  await archiveFolder.click();
  await expect(page.locator('.templates__row', { hasText: 'E2E Landing Template' })).toBeVisible();
});

test('journey: export/import panel — templates tree scope selection', async ({ page }) => {
  test.skip(!process.env['SF_RUN_E2E'], 'requires seeded demo backend (SF_RUN_E2E=1)');
  await login(page);

  await page.goto(`/p/${PROJECT_KEY}/settings/import-export`);
  await expect(page.locator('sf-project-settings-export')).toBeVisible();

  // The panel offers Templates as a fourth tree scope alongside Pages/Media/Navigation
  // (M13.3.3), each with its own "Select all" toggle — mirroring the other three sections.
  const templatesSection = page.locator('.tree-section', { has: page.getByText('Templates', { exact: true }) });
  await expect(templatesSection).toBeVisible();
  const selectAllTemplates = templatesSection.getByRole('button', { name: /Select all templates/i });
  await expect(selectAllTemplates).toBeVisible();

  // Expand "Page Templates" and check its own row: the checkbox reflects the explicit pick,
  // and the panel's Export button becomes enabled — matching the existing Pages/Media/
  // Navigation tree-selection UI bar (M11.3's original three trees).
  const pageTemplatesRow = templatesSection.locator('.tree-row', { hasText: 'Page Templates' }).first();
  await expect(pageTemplatesRow).toBeVisible();
  const pageTemplatesCheckbox = pageTemplatesRow.locator('.tree-row__checkbox');
  await pageTemplatesCheckbox.check();
  await expect(pageTemplatesCheckbox).toBeChecked();

  const exportButton = page.getByRole('button', { name: /^Export$/ });
  await expect(exportButton).toBeEnabled();

  // "Select all templates" flips on the checkbox-style "select all" icon state for the store —
  // `sf-icon` renders its `name()` input as the ligature text content of an inner `<span>`.
  await selectAllTemplates.click();
  await expect(selectAllTemplates.locator('sf-icon .sf-icon')).toHaveText('check_box');
});
