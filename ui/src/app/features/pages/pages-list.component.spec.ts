import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { stubReleaseBar } from '../release/testing/release-bar.stub';
import { FolderDetailComponent } from './folder-detail.component';
import { PagesListComponent } from './pages-list.component';

type FolderView = components['schemas']['FolderView'];
type AssetSummaryView = components['schemas']['AssetSummaryView'];

const HOME = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1b01';
const ROOT_UUID = '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a00';

// GET /folders?scope=PAGES as FolderController#list sends it: the protected pages root (the site root) with its
// start page pointer (M31.1) and one subfolder.
const TREE: FolderView[] = [
  {
    uuid: ROOT_UUID,
    uid: 'pages_root',
    displayName: 'All Pages',
    path: '/pages_root/',
    scope: 'PAGES',
    protectedFolder: true,
    type: 'FOLDER',
    revision: 7,
    startPageUuid: HOME,
    scheduled: [],
    children: [
      {
        uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1a10',
        uid: 'products',
        displayName: 'Products',
        path: '/pages_root/products/',
        scope: 'PAGES',
        protectedFolder: false,
        type: 'FOLDER',
        revision: 12,
        scheduled: [],
        children: [],
      },
    ],
  },
];

// GET /pages summaries.
const ROOT_PAGES: AssetSummaryView[] = [
  { uuid: HOME, uid: 'homepage', type: 'PAGE', displayName: 'Homepage', folderPath: '/pages_root/', revision: 5 },
  { uuid: '0f7e6a53-8a1d-4f55-9d3a-1c1c7a2f1b02', uid: 'contact', type: 'PAGE', displayName: 'Contact', folderPath: '/pages_root/', revision: 4 },
];

/** The store as the tree's rows read it too (page rows follow the open editor). */
function projectStoreWithTree() {
  return {
    ...projectStoreStub(),
    pageFolderTree: signal(TREE),
    pageMutated: signal<string | null>(null),
    activePageUuid: signal<string | null>(null),
    activeBodyName: signal<string | null>(null),
    activeSectionInstanceId: signal<string | null>(null),
    sectionTemplates: signal([]),
  };
}

function projectStoreStub() {
  return {
    pageFolderTree: signal([]),
    pageTemplates: signal([{ uuid: 'tpl-1', displayName: 'Landing' }]),
    loadFor: vi.fn().mockReturnValue(of(undefined)),
  };
}

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    listPages: vi.fn().mockReturnValue(of([])),
    createPage: vi.fn().mockReturnValue(of({ uuid: 'page-1' })),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'folder-1' })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    ...overrides,
  };
}

describe('PagesListComponent', () => {
  it('opens the create-page dialog and calls ApiClient.createPage on submit, then reloads the list', async () => {
    const api = apiStub();
    const store = projectStoreStub();
    await render(PagesListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ProjectContextStore, useValue: store },
      ],
    });

    screen.getByRole('button', { name: 'New page' }).click();

    // `findBy*`/`fireEvent` run change detection: the dialog only renders on the pass after the
    // click, and its submit button stays `[disabled]` until the form reads as valid.
    fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'My Page' } });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl-1' } });

    screen.getByRole('button', { name: 'Create' }).click();

    expect(api.createPage).toHaveBeenCalledWith('proj', {
      displayName: 'My Page',
      templateUuid: 'tpl-1',
      folderUuid: undefined,
    });
    expect(api.listPages).toHaveBeenCalled();
  });

  it('opens the create-folder dialog scoped to PAGES and calls ApiClient.createFolder on submit', async () => {
    const api = apiStub();
    const store = projectStoreStub();
    await render(PagesListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ProjectContextStore, useValue: store },
      ],
    });

    screen.getByTitle('New folder').click();

    fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Assets' } });

    screen.getByRole('button', { name: 'Create' }).click();

    expect(api.createFolder).toHaveBeenCalledWith('proj', {
      displayName: 'Assets',
      parentFolderUuid: undefined,
      scope: 'PAGES',
    });
  });

  it('offers no page or folder creation in an archived project (M26)', async () => {
    await render(PagesListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: ProjectContextStore, useValue: projectStoreStub() },
      ],
      configureTestBed: (tb) => tb.inject(ProjectAccessStore).enterProject('proj', true),
    });

    expect((screen.getByRole('button', { name: 'New page' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('New folder') as HTMLButtonElement).disabled).toBe(true);
  });
  describe('the site root (M31)', () => {
    async function renderWithRoot() {
      stubReleaseBar(FolderDetailComponent);
      const api = apiStub({ listPages: vi.fn().mockReturnValue(of(ROOT_PAGES)) });
      await render(PagesListComponent, {
        componentInputs: { projectKey: 'proj' },
        providers: [
          { provide: ApiClient, useValue: api },
          { provide: ProjectContextStore, useValue: projectStoreWithTree() },
          provideProjectPermissions({ role: () => 'EDITOR' }),
        ],
      });
      return api;
    }

    it('"All pages" opens the pages root’s folder panel with its start page, without rename or delete', async () => {
      await renderWithRoot();
      fireEvent.click(screen.getByRole('button', { name: /All pages/ }));

      expect(await screen.findByRole('heading', { name: 'All Pages' })).toBeTruthy();
      const select = screen.getByRole('combobox') as HTMLSelectElement;
      expect(Array.from(select.options).map((option) => option.textContent?.trim())).toEqual([
        '— None (index page UID rule) —',
        'Contact',
        'Homepage',
      ]);
      expect(select.value).toBe(HOME);
      expect(screen.queryByRole('button', { name: 'Rename folder' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Delete folder' })).toBeNull();
    });

    it('opens the same panel from the root’s context menu "Folder settings…"', async () => {
      await renderWithRoot();
      fireEvent.contextMenu(screen.getByRole('button', { name: /All pages/ }));
      const menu = TestBed.inject(ContextMenuService).state();
      expect(menu?.items.map((item) => item.label)).toEqual(['Folder settings…', '', 'New page', 'New subfolder']);
      menu!.items[0].action!();

      expect(await screen.findByRole('heading', { name: 'All Pages' })).toBeTruthy();
    });

    it('badges the root’s start page in the tree', async () => {
      await renderWithRoot();
      const badges = await screen.findAllByText('Start page', { selector: '.page-nav__start' });
      expect(badges).toHaveLength(1);
      expect(badges[0].closest('.page-nav__row')?.textContent).toContain('Homepage');
    });

    it('still creates a new page at the project root while "All pages" is open', async () => {
      const api = await renderWithRoot();
      fireEvent.click(screen.getByRole('button', { name: /All pages/ }));
      await screen.findByRole('heading', { name: 'All Pages' });
      fireEvent.click(screen.getByRole('button', { name: 'New page' }));
      fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Imprint' } });
      fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl-1' } });
      fireEvent.click(screen.getByRole('button', { name: 'Create' }));

      expect(api.createPage).toHaveBeenCalledWith('proj', { displayName: 'Imprint', templateUuid: 'tpl-1', folderUuid: undefined });
    });
  });
});
