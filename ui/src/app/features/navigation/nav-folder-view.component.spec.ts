import '@angular/compiler';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { ToastService } from '../../core/ui/toast.service';
import { NavFolderViewComponent } from './nav-folder-view.component';
import { buildNavIndex } from './navigation-tree.util';
import { NavigationService } from './navigation.service';
import type { NavTreeView } from './navigation.service';

/** The menu folder view (M35.22): the entry page, the table of items (label, target page, public URL) and the bulk actions. */

const TREE: NavTreeView[] = [
  {
    uuid: 'root',
    uid: 'navigation_root',
    type: 'FOLDER',
    displayName: 'All Navigation',
    revision: 9,
    children: [
      {
        uuid: 'n-company',
        uid: 'company',
        type: 'FOLDER',
        displayName: 'Company',
        label: 'Company',
        resolvedPageUuid: 'p-about',
        resolvedPageName: 'About us',
        revision: 4,
        children: [
          { uuid: 'n-about', uid: 'about', type: 'PAGE_REFERENCE', displayName: 'About', label: 'About us', resolvedPageUuid: 'p-about', resolvedPageName: 'About us', revision: 1, children: [] },
          { uuid: 'n-team', uid: 'team', type: 'PAGE_REFERENCE', displayName: 'Team', label: 'Our team', resolvedPageUuid: 'p-team', resolvedPageName: 'Team', revision: 1, children: [] },
          { uuid: 'n-loose', uid: 'loose', type: 'PAGE_REFERENCE', displayName: 'Loose', label: 'Loose end', revision: 1, children: [] },
          { uuid: 'n-sub', uid: 'sub', type: 'FOLDER', displayName: 'Careers', label: 'Careers', revision: 1, children: [] },
        ],
      },
    ],
  },
];
const URLS = new Map([
  ['p-about', '/about-us/'],
  ['p-team', '/about-us/team/'],
]);

async function open(options: { canEdit?: boolean; dev?: boolean; startNode?: unknown; nav?: Record<string, unknown>; failed?: boolean } = {}) {
  const index = buildNavIndex(TREE);
  const nav = {
    updateFolder: vi.fn().mockReturnValue(of({ revision: 5 })),
    ...options.nav,
  };
  const api = {
    assetDetail: vi.fn().mockReturnValue(of({ revision: 4, payload: { startNode: options.startNode ?? { kind: 'PAGE_REFERENCE', assetUuid: 'n-about' } } })),
  };
  const view = await render(NavFolderViewComponent, {
    componentInputs: {
      projectKey: 'proj',
      folder: index.entries.get('n-company')!,
      index,
      urls: URLS,
      failed: options.failed ?? false,
    },
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideFavoritesStub(),
      { provide: NavigationService, useValue: nav },
      { provide: ApiClient, useValue: api },
      { provide: FrameContextStore, useValue: { setItem: vi.fn() } },
      { provide: DeveloperModeService, useValue: { enabled: signal(options.dev ?? false) } },
      { provide: ProjectPermissionsStore, useValue: { canEditContent: signal(options.canEdit ?? true) } },
    ],
  });
  const component = view.fixture.componentInstance as unknown as Record<string, { subscribe(fn: unknown): void }>;
  const outputs = {
    openEntry: vi.fn(),
    newItem: vi.fn(),
    rename: vi.fn(),
    moveEntries: vi.fn(),
    deleteEntries: vi.fn(),
    retry: vi.fn(),
    changed: vi.fn(),
  };
  for (const [name, spy] of Object.entries(outputs)) {
    component[name].subscribe(spy);
  }
  return { view, nav, api, outputs, toasts: TestBed.inject(ToastService) };
}

describe('the menu folder view', () => {
  it('has the folder as the h1 with where it leads ("Opens /about-us/")', async () => {
    await open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Company' })).toBeTruthy();
    expect(screen.getByText('Opens /about-us/')).toBeTruthy();
  });

  it('lists its entries in menu order with label, target page and public URL — and no internal folder path', async () => {
    await open();
    const rows = await screen.findAllByRole('row');
    expect(rows.length).toBe(5);

    expect(within(rows[1]).getByText('About us', { selector: '.cell-label__text' })).toBeTruthy();
    expect(within(rows[1]).getByText('/about-us/')).toBeTruthy();
    expect(within(rows[2]).getByText('Our team')).toBeTruthy();
    expect(within(rows[2]).getByText('Team', { selector: '.cell-target' })).toBeTruthy();
    expect(within(rows[2]).getByText('/about-us/team/')).toBeTruthy();
    expect(within(rows[3]).getByText('No target page yet')).toBeTruthy();
    expect(within(rows[4]).getByText('Careers')).toBeTruthy();
    expect(screen.getByText('Public URL')).toBeTruthy();
    expect(screen.getByText('Target page')).toBeTruthy();
    expect(document.body.textContent).not.toContain('navigation_root');
  });

  it('marks the entry page with a badge', async () => {
    await open();
    const rows = await screen.findAllByRole('row');
    await waitFor(() => expect(within(rows[1]).getByText('Entry page')).toBeTruthy());
    expect(within(rows[2]).queryByText('Entry page')).toBeNull();
  });

  it('opens an entry with a click on its row', async () => {
    const { outputs } = await open();
    const rows = await screen.findAllByRole('row');
    fireEvent.click(within(rows[2]).getByText('Our team'));
    expect(outputs.openEntry).toHaveBeenCalledWith('n-team');
  });

  it('asks the area to add a menu item, and to rename, move or delete the folder from its ⋮ menu', async () => {
    const { outputs } = await open();
    fireEvent.click(screen.getByRole('button', { name: 'New menu item' }));
    expect(outputs.newItem).toHaveBeenCalled();

    for (const [name, spy] of [
      ['Rename', outputs.rename],
      ['Move…', outputs.moveEntries],
      ['Delete…', outputs.deleteEntries],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: new RegExp(`^${name}`) }));
      expect(spy).toHaveBeenCalled();
    }
    expect(outputs.moveEntries.mock.calls[0][0].map((e: { uuid: string }) => e.uuid)).toEqual(['n-company']);
  });

  it('offers bulk Move… and Delete on selected rows', async () => {
    const { outputs } = await open();
    const rows = await screen.findAllByRole('row');
    fireEvent.click(within(rows[2]).getByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(outputs.deleteEntries.mock.calls[0][0].map((e: { uuid: string }) => e.uuid)).toEqual(['n-team']);
  });

  describe('the entry page', () => {
    it('is a select of the folder\'s own entries, set to the stored one', async () => {
      await open();
      const select = await screen.findByRole('combobox', { name: /Entry page/ });
      await waitFor(() => expect(select.textContent).toContain('About us'));
    });

    it('changes it with a toast that offers Undo (which writes the previous one back)', async () => {
      const { nav, toasts, outputs } = await open();
      const select = await screen.findByRole('combobox', { name: /Entry page/ });
      await waitFor(() => expect(select.textContent).toContain('About us'));
      fireEvent.change(select, { target: { value: '1' } });

      await waitFor(() =>
        expect(nav['updateFolder']).toHaveBeenCalledWith('proj', 'n-company', { startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'n-team' } }, '"rev-4"'),
      );
      await waitFor(() => expect(outputs.changed).toHaveBeenCalled());
      const toast = toasts.toasts().at(-1)!;
      expect(toast.message).toBe('“Our team” is now the entry page.');
      expect(toast.action).toBeTruthy();

      toast.action!.run();
      await waitFor(() =>
        expect(nav['updateFolder']).toHaveBeenLastCalledWith('proj', 'n-company', { startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'n-about' } }, '"rev-5"'),
      );
    });

    it('is disabled for a viewer', async () => {
      await open({ canEdit: false });
      expect(await screen.findByRole('combobox', { name: /Entry page/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'New menu item' })).toBeDisabled();
    });
  });

  it('shows the folder UID only in developer mode', async () => {
    await open({ dev: true });
    expect(await screen.findByText('company')).toBeTruthy();
  });

  it('says it could not load, with Retry', async () => {
    const { outputs } = await open({ failed: true });
    fireEvent.click(await screen.findByRole('button', { name: /retry/i }));
    expect(outputs.retry).toHaveBeenCalled();
  });
});
