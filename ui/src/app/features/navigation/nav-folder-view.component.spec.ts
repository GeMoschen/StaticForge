import '@angular/compiler';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { provideFavoritesStub } from '../../core/assets/testing/favorites.testing';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { FrameContextStore } from '../../core/frame/frame-context.store';
import { ProjectPermissionsStore } from '../../core/project/project-permissions.store';
import { NavFolderViewComponent } from './nav-folder-view.component';
import { buildNavIndex } from './navigation-tree.util';
import { NavigationService } from './navigation.service';
import type { NavTreeView } from './navigation.service';

/**
 * The menu folder view (M35.22): the entry page line, the table of items (label, target page, public URL, visible in menu)
 * and the bulk actions (move, show / hide in the menu, delete); also for the fixed "All navigation" wrapper.
 */

const TREE: NavTreeView[] = [
  {
    uuid: 'root',
    uid: 'navigation_root',
    type: 'FOLDER',
    displayName: 'All Navigation',
    protectedFolder: true,
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
        startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'n-about' },
        revision: 4,
        children: [
          { uuid: 'n-about', uid: 'about', type: 'PAGE_REFERENCE', displayName: 'About', label: 'About us', resolvedPageUuid: 'p-about', resolvedPageName: 'About us', revision: 1, children: [] },
          { uuid: 'n-team', uid: 'team', type: 'PAGE_REFERENCE', displayName: 'Team', label: 'Our team', resolvedPageUuid: 'p-team', resolvedPageName: 'Team', visibleInMenu: false, revision: 1, children: [] },
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

async function open(options: { canEdit?: boolean; dev?: boolean; folder?: 'n-company' | 'n-sub' | 'root'; failed?: boolean } = {}) {
  const index = buildNavIndex(TREE);
  const folder = options.folder === 'root' ? index.root! : index.entries.get(options.folder ?? 'n-company')!;
  const view = await render(NavFolderViewComponent, {
    componentInputs: {
      projectKey: 'proj',
      folder,
      index,
      urls: URLS,
      failed: options.failed ?? false,
    },
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideFavoritesStub(),
      { provide: NavigationService, useValue: {} },
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
    changeEntry: vi.fn(),
    setVisible: vi.fn(),
  };
  for (const [name, spy] of Object.entries(outputs)) {
    component[name].subscribe(spy);
  }
  return { view, outputs, folder };
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
    expect(within(rows[1]).getByText('Entry page')).toBeTruthy();
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
    const line = () => document.querySelector('.view__entry') as HTMLElement;

    it('is a line in the header with the chosen entry and the page it leads to', async () => {
      await open();
      expect(within(line()).getByText('Entry page')).toBeTruthy();
      expect(within(line()).getByText('About us', { selector: '.view__entry-value' })).toBeTruthy();
      expect(within(line()).getByText('→ About us')).toBeTruthy();
      expect(within(line()).getByRole('button', { name: 'Change…' })).toBeTruthy();
    });

    it('says "None — grouping only" for a folder without one', async () => {
      await open({ folder: 'n-sub' });
      expect(within(line()).getByText('None — grouping only')).toBeTruthy();
      expect(within(line()).queryByText(/→/)).toBeNull();
    });

    it('asks the area to open the entry-page drawer from Change… and from the ⋮ menu', async () => {
      const { outputs, folder } = await open();
      fireEvent.click(within(line()).getByRole('button', { name: 'Change…' }));
      expect(outputs.changeEntry).toHaveBeenLastCalledWith(folder);

      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /^Entry page…/ }));
      expect(outputs.changeEntry).toHaveBeenCalledTimes(2);
    });

    it('cannot be changed by a viewer', async () => {
      await open({ canEdit: false });
      expect(within(line()).getByRole('button', { name: 'Change…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'New menu item' })).toBeDisabled();
    });
  });

  describe('Visible in menu', () => {
    it('is a column: hidden rows say so and are muted, the others are in the menu', async () => {
      await open();
      expect(screen.getByText('Visible in menu', { selector: '*' })).toBeTruthy();
      const rows = await screen.findAllByRole('row');
      expect(within(rows[1]).getByText('In menu')).toBeTruthy();
      expect(within(rows[2]).getByText('Hidden from menu')).toBeTruthy();
      expect(within(rows[2]).getByText('Our team', { selector: '.cell-label__text' }).classList.contains('cell-label__text--muted')).toBe(true);
      expect(within(rows[1]).getByText('About us', { selector: '.cell-label__text' }).classList.contains('cell-label__text--muted')).toBe(false);
    });

    it('sorts by the column (hidden first when ascending)', async () => {
      await open();
      fireEvent.click(screen.getByRole('button', { name: /Visible in menu/ }));
      const rows = await screen.findAllByRole('row');
      expect(within(rows[1]).getByText('Our team', { selector: '.cell-label__text' })).toBeTruthy();
    });

    it('has bulk Show in menu and Hide from menu on the selected rows', async () => {
      const { outputs } = await open();
      const rows = await screen.findAllByRole('row');
      fireEvent.click(within(rows[1]).getByRole('checkbox'));
      fireEvent.click(within(rows[2]).getByRole('checkbox'));

      fireEvent.click(await screen.findByRole('button', { name: 'Hide from menu' }));
      expect(outputs.setVisible).toHaveBeenLastCalledWith({ entries: expect.any(Array), visible: false });
      expect(outputs.setVisible.mock.calls[0][0].entries.map((e: { uuid: string }) => e.uuid)).toEqual(['n-about', 'n-team']);

      fireEvent.click(screen.getByRole('button', { name: 'Show in menu' }));
      expect(outputs.setVisible).toHaveBeenLastCalledWith({ entries: expect.any(Array), visible: true });
    });

    it('offers no bulk actions to a viewer', async () => {
      await open({ canEdit: false });
      const rows = await screen.findAllByRole('row');
      fireEvent.click(within(rows[1]).getByRole('checkbox'));
      expect(screen.queryByRole('button', { name: 'Hide from menu' })).toBeNull();
    });

    it('hides and shows the folder itself from its ⋮ menu', async () => {
      const { outputs } = await open();
      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: /^Hide from menu/ }));
      expect(outputs.setVisible).toHaveBeenCalledWith({ entries: [expect.objectContaining({ uuid: 'n-company' })], visible: false });
    });
  });

  describe('the "All navigation" wrapper', () => {
    it('is a folder view of the top level with its entry page, but nothing to rename, move, hide or delete', async () => {
      await open({ folder: 'root' });
      const rows = await screen.findAllByRole('row');
      expect(rows.length).toBe(2);
      expect(within(rows[1]).getByText('Company')).toBeTruthy();
      expect(document.querySelector('.view__entry')?.textContent).toContain('None — grouping only');
      expect(document.querySelector('.view__title-extras sf-asset-favorite')).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
      expect(await screen.findByRole('menuitem', { name: /^Entry page…/ })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: /^Rename/ })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /^Delete/ })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: /^Hide from menu/ })).toBeNull();
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
