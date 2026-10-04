import '@angular/compiler';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { mergeMap, of, throwError, timer } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { provideProjectPermissions } from '../../core/project/testing/project-permissions.testing';
import { ToastService } from '../../core/ui/toast.service';
import { NavEntryDrawerComponent } from './nav-entry-drawer.component';
import { buildNavIndex } from './navigation-tree.util';
import { type NavTreeView, NavigationService } from './navigation.service';

/** The entry-page drawer (decision 168): None or one of the folder's direct children, applied as one revision with Undo. */

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
          { uuid: 'n-sub', uid: 'sub', type: 'FOLDER', displayName: 'Careers', label: 'Careers', resolvedPageUuid: 'p-jobs', resolvedPageName: 'Jobs', revision: 1, children: [] },
        ],
      },
      { uuid: 'n-home', uid: 'home', type: 'PAGE_REFERENCE', displayName: 'Home', label: 'Home', resolvedPageUuid: 'p-home', resolvedPageName: 'Welcome', revision: 2, children: [] },
    ],
  },
];
const URLS = new Map([
  ['p-about', '/about-us/'],
  ['p-team', '/about-us/team/'],
]);

async function open(options: { canEdit?: boolean; folder?: 'n-company' | 'root'; nav?: Record<string, unknown> } = {}) {
  const index = buildNavIndex(TREE);
  const folder = options.folder === 'root' ? index.root! : index.entries.get('n-company')!;
  const nav = { updateFolder: vi.fn().mockReturnValue(of({ revision: 5 })), ...options.nav };
  const view = await render(NavEntryDrawerComponent, {
    componentInputs: { projectKey: 'proj', folder: { ...folder, label: options.folder === 'root' ? 'All navigation' : folder.label }, index, urls: URLS },
    providers: [{ provide: NavigationService, useValue: nav }, provideProjectPermissions({ role: () => (options.canEdit === false ? 'VIEWER' : 'EDITOR'), readOnly: () => false })],
  });
  const component = view.fixture.componentInstance as unknown as Record<string, { subscribe(fn: unknown): void }>;
  const outputs = { closed: vi.fn(), changed: vi.fn() };
  for (const [name, spy] of Object.entries(outputs)) {
    component[name].subscribe(spy);
  }
  return { view, nav, outputs, toasts: TestBed.inject(ToastService) };
}

const radio = (name: RegExp) => screen.getByRole('radio', { name });
const apply = () => screen.getByRole('button', { name: 'Apply' });

describe('the entry-page drawer', () => {
  it('is titled with the folder and lists None plus every direct child — menu items and sub-folders — with where they lead', async () => {
    await open();
    expect(await screen.findByRole('heading', { name: 'Entry page — Company' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((r) => r.closest('label')?.textContent?.trim())).toEqual([
      'None — grouping only',
      'About us',
      'Our team',
      'Loose end',
      'Careers',
    ]);
    expect(screen.getByText('Menu item · leads to /about-us/')).toBeTruthy();
    expect(screen.getByText('Menu item · leads to no page yet')).toBeTruthy();
    expect(screen.getByText('Folder · leads to Jobs')).toBeTruthy();
  });

  it('starts on the stored entry page, with Apply disabled until the choice changes', async () => {
    await open();
    expect(radio(/^About us/)).toBeChecked();
    expect(apply()).toBeDisabled();
    fireEvent.click(radio(/^Our team/));
    expect(apply()).not.toBeDisabled();
    fireEvent.click(radio(/^About us/));
    expect(apply()).toBeDisabled();
  });

  it('applies a menu item as the entry page with the folder\'s revision, closes, and offers Undo that writes the previous one back', async () => {
    const { nav, outputs, toasts } = await open();
    fireEvent.click(radio(/^Our team/));
    fireEvent.click(apply());

    await waitFor(() =>
      expect(nav['updateFolder']).toHaveBeenCalledWith('proj', 'n-company', { startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'n-team' } }, '"rev-4"'),
    );
    await waitFor(() => expect(outputs.closed).toHaveBeenCalled());
    expect(outputs.changed).toHaveBeenCalled();
    const toast = toasts.toasts().at(-1)!;
    expect(toast.message).toBe('“Our team” is now the entry page.');

    toast.action!.run();
    await waitFor(() =>
      expect(nav['updateFolder']).toHaveBeenLastCalledWith('proj', 'n-company', { startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'n-about' } }, '"rev-5"'),
    );
  });

  it('applies a sub-folder as a FOLDER start node', async () => {
    const { nav } = await open();
    fireEvent.click(radio(/^Careers/));
    fireEvent.click(apply());
    await waitFor(() =>
      expect(nav['updateFolder']).toHaveBeenCalledWith('proj', 'n-company', { startNode: { kind: 'FOLDER', assetUuid: 'n-sub' } }, '"rev-4"'),
    );
  });

  it('clears the entry page with None', async () => {
    const { nav, toasts } = await open();
    fireEvent.click(radio(/^None/));
    fireEvent.click(apply());
    await waitFor(() => expect(nav['updateFolder']).toHaveBeenCalledWith('proj', 'n-company', { startNode: null }, '"rev-4"'));
    await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('The folder has no entry page now.'));
  });

  it('works for the "All navigation" wrapper, against its own revision', async () => {
    const { nav } = await open({ folder: 'root' });
    expect(await screen.findByRole('heading', { name: 'Entry page — All navigation' })).toBeTruthy();
    expect(radio(/^None/)).toBeChecked();
    fireEvent.click(radio(/^Home/));
    fireEvent.click(apply());
    await waitFor(() =>
      expect(nav['updateFolder']).toHaveBeenCalledWith('proj', 'root', { startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'n-home' } }, '"rev-9"'),
    );
  });

  it('stays open and says so when the write is refused', async () => {
    const { outputs, toasts } = await open({ nav: { updateFolder: vi.fn().mockReturnValue(timer(0).pipe(mergeMap(() => throwError(() => new Error('409'))))) } });
    fireEvent.click(radio(/^Our team/));
    fireEvent.click(apply());
    await waitFor(() => expect(toasts.toasts().at(-1)?.message).toBe('Could not change the entry page — try again in a moment.'));
    expect(outputs.closed).not.toHaveBeenCalled();
  });

  it('cancels without writing', async () => {
    const { nav, outputs } = await open();
    fireEvent.click(radio(/^Our team/));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(outputs.closed).toHaveBeenCalled();
    expect(nav['updateFolder']).not.toHaveBeenCalled();
  });

  it('is read-only for a viewer: the choices and Apply are disabled', async () => {
    await open({ canEdit: false });
    expect(await screen.findByText(/can look at the entry page, but not change it/)).toBeTruthy();
    expect(radio(/^Our team/)).toBeDisabled();
    expect(apply()).toBeDisabled();
  });
});
