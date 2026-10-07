import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { ContextMenuService } from '../../../../shared/services/context-menu.service';
import { SampleScreenComponent } from '../sample-screen.component';

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  await screen.findAllByRole('treeitem');
  return result;
}

const menu = () => TestBed.inject(ContextMenuService).state()?.items;
const labels = () => (menu() ?? []).filter((item) => item.label !== '').map((item) => item.label);
const entry = (label: string) => (menu() ?? []).find((item) => item.label === label);

/** Pages sample, M35.22 follow-ups: the menus, the empty-space handling and the page URLs follow the app. */
describe('pages sample: menus and URLs', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete document.documentElement.dataset['theme'];
    delete document.documentElement.dataset['density'];
  });

  describe('folder table row menu', () => {
    it('offers a page the app’s entries in the app’s order, without Copy for a folder', async () => {
      await setup();
      const row = (name: RegExp) => screen.getByRole('row', { name });

      fireEvent.contextMenu(row(/Contact/));
      await waitFor(() => expect(menu()).toBeDefined());
      expect(labels()).toEqual(['Rename…', 'Cut', 'Copy', 'Paste', 'Move to…', 'Add to favorites', 'Duplicate', 'Release', 'Delete']);
      expect(entry('Paste')?.disabled).toBe(true);
      expect(entry('Release')?.disabled).toBeFalsy();
      expect(entry('Delete')?.danger).toBe(true);

      fireEvent.contextMenu(row(/About us/));
      await waitFor(() => expect(labels()).toContain('New folder'));
      expect(labels()).toEqual(['New page', 'New folder', 'Rename…', 'Cut', 'Paste', 'Move to…', 'Add to favorites', 'Release', 'Delete']);
    });

    it('says nothing is waiting when Release is chosen on a released page', async () => {
      await setup();
      const show = vi.spyOn(TestBed.inject(ToastService), 'show');

      fireEvent.contextMenu(screen.getByRole('row', { name: /Contact/ }));
      await waitFor(() => expect(menu()).toBeDefined());
      entry('Release')?.action?.();

      expect(show).toHaveBeenCalledWith('Nothing here is waiting to be released.', 'info');
    });

    it('enables Paste after Cut, for a folder other than the one the page is in', async () => {
      await setup();

      fireEvent.contextMenu(screen.getByRole('row', { name: /Contact/ }));
      await waitFor(() => expect(menu()).toBeDefined());
      entry('Cut')?.action?.();
      fireEvent.contextMenu(screen.getByRole('row', { name: /About us/ }));
      await waitFor(() => expect(labels()).toContain('New folder'));

      expect(entry('Paste')?.disabled).toBeFalsy();
    });

    it('turns into the bulk actions for a selection, Duplicate only when pages are in it', async () => {
      await setup();
      for (const name of [/Contact/, /About us/]) {
        fireEvent.click(screen.getAllByRole('checkbox', { name })[0]);
      }

      fireEvent.contextMenu(screen.getByRole('row', { name: /Contact/ }));
      await waitFor(() => expect(menu()).toBeDefined());
      expect(labels()).toEqual(['Move', 'Release', 'Duplicate', 'Delete']);
    });

    it('offers no menu entries while the project is read-only', async () => {
      await setup({ access: 'archived' });

      fireEvent.contextMenu(screen.getByRole('row', { name: /Contact/ }));
      await waitFor(() => expect(menu()).toBeDefined());
      expect(labels()).toEqual(['Add to favorites']);
    });
  });

  describe('empty space', () => {
    it('opens the root when the empty part of the tree is clicked, with New page and New folder in its menu', async () => {
      await setup({ view: 'folder' });
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('News');
      const tree = screen.getByRole('tree', { name: 'Pages' });

      fireEvent.contextMenu(tree);
      await waitFor(() => expect(menu()).toBeDefined());
      expect(labels()).toEqual(['Page', 'Folder']);

      fireEvent.click(tree);
      await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Pages'));
    });

    it('offers New page and New folder on the empty part of the folder table', async () => {
      await setup();

      fireEvent.contextMenu(screen.getByRole('grid', { name: 'Contents of Pages' }));
      await waitFor(() => expect(menu()).toBeDefined());
      expect(labels()).toEqual(['New page', 'New folder']);
    });
  });

  describe('tree menu', () => {
    it('gets Release next to Duplicate for a page and next to New page here for a folder', async () => {
      await setup();

      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^Contact/ }));
      await waitFor(() => expect(menu()).toBeDefined());
      expect(labels()).toEqual(expect.arrayContaining(['Duplicate', 'Release', 'Add to favorites']));

      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^News/ }));
      await waitFor(() => expect(labels()).toContain('New page here'));
      expect(labels()).toContain('Release');
      expect(labels()).not.toContain('Duplicate');
    });

    it('selects several nodes with Ctrl+click and offers Release for the selection', async () => {
      await setup();

      fireEvent.click(screen.getByRole('treeitem', { name: /^Contact/ }), { ctrlKey: true });
      fireEvent.click(screen.getByRole('treeitem', { name: /^Imprint/ }), { ctrlKey: true });
      fireEvent.contextMenu(screen.getByRole('treeitem', { name: /^Imprint/ }));

      await waitFor(() => expect(menu()).toBeDefined());
      expect(labels()).toContain('Release');
    });
  });


  describe('page URLs', () => {
    it('shows a registered URL plain and a computed one muted with “Not assigned yet”', async () => {
      await setup({ view: 'folder', dev: '1' });
      const grid = screen.getByRole('grid', { name: 'Contents of News' });

      expect(within(grid).getByText('/news/spring-harvest')).not.toHaveClass('cell-url--computed');
      const computed = within(grid).getByText('/news/barista-championship');
      expect(computed).toHaveClass('cell-url--computed');
      expect(computed).toHaveAttribute('title', 'Not assigned yet');
    });

    it('shows the page settings address plain when it is registered', async () => {
      await setup({ view: 'editor', dev: '1', psettings: 'page' });
      const drawer = await screen.findByRole('dialog', { name: 'Page settings' });

      expect(within(drawer).getByText('/news/spring-harvest')).not.toHaveClass('settings__computed');
    });
  });
});
