import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { ContextMenuService } from '../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../shared/services/tree-clipboard.service';
import { SampleScreenComponent } from './sample-screen.component';

/** The Content area's menus of the app (M35.22 follow-ups 3 and 4), announce only: tree, folder table and record grid. */
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

const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);
const menu = () => TestBed.inject(ContextMenuService).state()?.items ?? [];
const menuLabels = () => menu().map((item) => item.label);
const choose = (label: string) => {
  const item = menu().find((entry) => entry.label === label);
  expect(item, label).toBeDefined();
  item!.action?.();
};
const closeMenu = () => TestBed.inject(ContextMenuService).close();
const treeItem = (name: RegExp) => screen.findByRole('treeitem', { name });
const folderGrid = () => screen.getByRole('grid', { name: 'Contents of Shop' });
const rowNamed = (grid: HTMLElement, name: string) => {
  const label = Array.from(grid.querySelectorAll('.cell-name__text')).find((cell) => cell.textContent?.trim() === name);
  if (!label) {
    throw new Error(`No row named ${name}`);
  }
  return label.closest('tr')!;
};

afterEach(() => {
  closeMenu();
  TestBed.inject(TreeClipboardService).clear();
  TestBed.inject(ToastService).clear();
});

describe('content tree menus', () => {
  it('adds Release… to the folder and record set menus, after the favorite toggle', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(await treeItem(/^Shop/));

    fireEvent.contextMenu(await treeItem(/^Single origins/), { clientX: 40, clientY: 40 });
    expect(menuLabels()).toEqual(['Rename', 'Cut', 'Copy', 'Paste', 'Move to…', 'New record', 'History', 'Used by', 'Add to favorites', 'Release…', 'Delete']);

    closeMenu();
    fireEvent.contextMenu(await treeItem(/^Shop/), { clientX: 40, clientY: 40 });
    // Shop is one of the seeded favorites.
    expect(menuLabels()).toEqual(['New folder', 'Rename', 'Cut', 'Paste', 'Move to…', 'New record set', 'Remove from favorites', 'Release…', 'Delete']);
  });

  it('answers Release… on something released with an info toast, and on a draft with a release toast', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(await treeItem(/^Shop/));
    fireEvent.contextMenu(await treeItem(/^Single origins/), { clientX: 40, clientY: 40 });
    expect(menu().find((item) => item.label === 'Release…')?.disabled).toBeFalsy();
    choose('Release…');

    const toast = lastToast();
    expect(toast?.message).toMatch(/^(Nothing here is waiting to be released\.|Released “Single origins” \(prototype — nothing was published\)\.)$/);
  });

  it('has multi-select: Release… is all a selection of several entries offers besides the tree’s own entries', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(await treeItem(/^Shop/));
    const first = await treeItem(/^Single origins/);
    fireEvent.click(first);
    fireEvent.click(await treeItem(/^Espresso blends/), { ctrlKey: true });
    expect(screen.getAllByRole('treeitem', { selected: true })).toHaveLength(2);

    fireEvent.contextMenu(first, { clientX: 40, clientY: 40 });
    expect(menuLabels()).toEqual(['Cut', 'Copy', 'Paste', 'Move to…', 'Release…', 'Delete 2 items']);
  });

  it('opens the top level on a click on empty space and offers New folder and New record set on a right click', async () => {
    const { container } = await setup({ area: 'content', view: 'contentfolder' });
    const viewport = container.querySelector<HTMLElement>('.sf-tree__viewport')!;

    fireEvent.contextMenu(viewport, { clientX: 40, clientY: 600 });
    expect(menuLabels()).toEqual(['New folder', 'New record set']);

    closeMenu();
    fireEvent.click(viewport);
    expect(await screen.findByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
    expect(screen.queryByRole('grid', { name: 'Contents of Shop' })).toBeNull();
  });
});

describe('content folder table menus', () => {
  it('opens a record set row’s menu: Open, Rename…, Cut, Copy, Paste, Move to…, favorite, Release…, Delete', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.contextMenu(rowNamed(folderGrid(), 'Single origins'), { clientX: 400, clientY: 300 });

    expect(menuLabels()).toEqual(['Open', 'Rename…', 'Cut', 'Copy', 'Paste', 'Move to…', 'Add to favorites', 'Release…', 'Delete']);
    expect(menu().find((item) => item.label === 'Paste')?.disabled).toBe(true);
  });

  it('adds New folder and New record set on a folder row, and leaves Copy out', async () => {
    await setup({ area: 'content' });
    await waitFor(() => expect(screen.getByRole('grid', { name: 'Contents of Content' }).querySelectorAll('.cell-name__text')).toHaveLength(3));
    fireEvent.contextMenu(rowNamed(screen.getByRole('grid', { name: 'Contents of Content' }), 'Shop'), { clientX: 400, clientY: 300 });

    expect(menuLabels()).toEqual(['Open', 'New folder', 'New record set', 'Rename…', 'Cut', 'Paste', 'Move to…', 'Remove from favorites', 'Release…', 'Delete']);
  });

  it('offers Cut, Copy and the bulk actions on several rows, Move and Release… among them', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    const grid = folderGrid();
    fireEvent.click(within(rowNamed(grid, 'Single origins')).getByRole('checkbox'));
    fireEvent.click(within(rowNamed(grid, 'Espresso blends')).getByRole('checkbox'));

    fireEvent.contextMenu(rowNamed(grid, 'Single origins'), { clientX: 400, clientY: 300 });
    expect(menuLabels()).toEqual(['Cut', 'Copy', 'Move', 'Release…', 'Delete']);
  });

  it('has Release… in the bulk bar', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(within(rowNamed(folderGrid(), 'Single origins')).getByRole('checkbox'));

    const bulk = await screen.findByRole('group', { name: /bulk/i });
    for (const name of ['Move', 'Release…', 'Delete']) {
      expect(within(bulk).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('shares the clipboard with the tree: a copied record set pastes next to a record set row, announced with an Undo', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    const grid = folderGrid();
    fireEvent.contextMenu(rowNamed(grid, 'Single origins'), { clientX: 400, clientY: 300 });
    choose('Copy');
    expect(TestBed.inject(TreeClipboardService).nodes()?.mode).toBe('copy');

    closeMenu();
    fireEvent.contextMenu(rowNamed(grid, 'Espresso blends'), { clientX: 400, clientY: 300 });
    expect(menu().find((item) => item.label === 'Paste')?.disabled).toBeFalsy();
    choose('Paste');
    expect(lastToast()?.message).toBe('Copied “Single origins” (prototype — nothing was copied).');
    expect(lastToast()?.action).toBeDefined();
  });

  it('offers New folder and New record set on empty space', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.contextMenu(folderGrid().closest('sf-data-table')!.querySelector('.sf-data-table__scroller')!, { clientX: 400, clientY: 600 });

    expect(menuLabels()).toEqual(['New folder', 'New record set']);
    choose('New record set');
    expect(await screen.findByRole('dialog', { name: 'New record set' })).toBeInTheDocument();
  });

  it('opens the Rename dialog from the row menu', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.contextMenu(rowNamed(folderGrid(), 'Single origins'), { clientX: 400, clientY: 300 });
    choose('Rename…');

    expect(await screen.findByRole('dialog', { name: 'Rename “Single origins”' })).toBeInTheDocument();
  });
});

describe('record grid menus', () => {
  const grid = () => screen.getByRole('grid', { name: 'Records of Single origins' });

  it('opens a row’s menu with the bulk actions: Release, Move, Duplicate, Delete', async () => {
    await setup({ view: 'recordset' });
    const row = within(grid()).getAllByRole('row')[1];
    fireEvent.contextMenu(row, { clientX: 400, clientY: 300 });

    expect(menuLabels()).toEqual(['Release', 'Move', 'Duplicate', 'Delete']);
  });

  it('has Duplicate in the bulk bar and announces the copies with an Undo', async () => {
    await setup({ view: 'recordset' });
    const bulk = await screen.findByRole('group', { name: /bulk/i });
    for (const name of ['Release', 'Move', 'Duplicate', 'Delete']) {
      expect(within(bulk).getByRole('button', { name })).toBeInTheDocument();
    }

    fireEvent.click(within(bulk).getByRole('button', { name: 'Duplicate' }));
    expect(lastToast()?.message).toBe('Duplicated 2 records (prototype — nothing was copied).');
    expect(lastToast()?.action).toBeDefined();
  });

  it('acts on the row alone when it is not part of the selection', async () => {
    await setup({ view: 'recordset' });
    const row = within(grid())
      .getAllByRole('row')
      .slice(1)
      .find((candidate) => !within(candidate).getByRole('checkbox').hasAttribute('checked') && !(within(candidate).getByRole('checkbox') as HTMLInputElement).checked)!;
    fireEvent.contextMenu(row, { clientX: 400, clientY: 300 });
    choose('Duplicate');

    expect(lastToast()?.message).toMatch(/^Duplicated “.+” \(prototype/);
  });

  it('offers New record on empty space', async () => {
    await setup({ view: 'recordset' });
    fireEvent.contextMenu(grid().closest('sf-data-table')!.querySelector('.sf-data-table__scroller')!, { clientX: 400, clientY: 700 });

    expect(menuLabels()).toEqual(['New record']);
    choose('New record');
    await waitFor(() => expect(lastToast()?.message).toBe('Creating a record is not part of the sample.'));
  });
});
