import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SpyLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
import { ContextMenuService } from '../../../../shared/services/context-menu.service';
import { TreeClipboardService } from '../../../../shared/services/tree-clipboard.service';
import { SampleNavigationAreaComponent } from './sample-navigation-area.component';

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleNavigationAreaComponent, {
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

const navTree = () => screen.getByRole('tree', { name: 'Navigation' });
const nameOf = (row: Element) => row.querySelector('.sf-tree__name')?.textContent?.trim();
const names = (tree: HTMLElement = navTree()) => within(tree).queryAllByRole('treeitem').map(nameOf);
const rowNamed = (name: string, tree: HTMLElement = navTree()) => {
  const row = within(tree)
    .queryAllByRole('treeitem')
    .find((r) => nameOf(r) === name);
  if (!row) {
    throw new Error(`No row named ${name}`);
  }
  return row;
};
const h1 = () => screen.getByRole('heading', { level: 1 });
const entryLine = () => screen.getByRole('group', { name: 'Entry page' });
/** The open context menu's entries (a separator is a flag on the entry below it) and a way to choose one; the shared service renders it. */
const menu = () => TestBed.inject(ContextMenuService).state()?.items ?? [];
const menuLabels = () => menu().map((item) => item.label);
const choose = (label: string) => {
  const item = menu().find((entry) => entry.label === label);
  expect(item, label).toBeDefined();
  item!.action?.();
};
const tableRow = (name: string) => {
  const label = Array.from(screen.getByRole('grid').querySelectorAll('.cell-label__text')).find((cell) => cell.textContent?.trim() === name);
  if (!label) {
    throw new Error(`No row labelled ${name}`);
  }
  return label.closest('tr')!;
};
const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);

/** The query string the area last wrote (it replaces the history entry in place). */
function watchQuery(): () => string {
  const replace = vi.spyOn(SpyLocation.prototype, 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
}

describe('SampleNavigationAreaComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows the menu in navigation order with each entry’s public URL, and asks for a selection', async () => {
    await setup();

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(h1()).toHaveTextContent('Navigation');
    expect(screen.getByText('Select a menu item')).toBeInTheDocument();
    expect(names()).toEqual(['Home', 'Coffee', 'Roastery', 'News', 'Contact', 'Imprint']);
    expect(rowNamed('Contact').querySelector('.sf-tree__secondary')).toHaveTextContent('→ /contact');
    // A folder leads where its entry page does.
    expect(rowNamed('Roastery').querySelector('.sf-tree__secondary')).toHaveTextContent('→ /about/our-story');
    // Hidden items are marked; no UIDs outside developer mode.
    expect(within(rowNamed('Imprint')).getByText('Hidden from menu')).toBeInTheDocument();
    expect(navTree()).not.toHaveTextContent('nav_contact');
  });

  it('selects a folder from the query: its entry page and a table of its items', async () => {
    const url = watchQuery();
    await setup({ nav: 'n-coffee' });

    expect(h1()).toHaveTextContent('Coffee');
    const table = screen.getByRole('grid', { name: 'Menu items in Coffee' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Single origins');
    expect(rows[1]).toHaveTextContent('Blends');
    expect(rows[2]).toHaveTextContent('Equipment');
    expect(within(rows[0]).getByText('Entry page')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Espresso blends')).toBeInTheDocument();
    expect(within(rows[1]).getByText('/shop/espresso')).toBeInTheDocument();
    expect(within(rows[1]).getByText('In menu')).toBeInTheDocument();
    expect(entryLine()).toHaveTextContent('Single origins');
    expect(entryLine()).toHaveTextContent('→ Single origins');
    // The tree shows the folder open and selected.
    expect(rowNamed('Coffee')).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(names()).toContain('Blends'));
    expect(url()).toContain('nav=n-coffee');
  });

  it('shows a menu item’s target page by name and URL — never a UUID outside developer mode', async () => {
    await setup({ nav: 'n-company' });

    expect(h1()).toHaveTextContent('Company');
    expect(screen.getByText('Our story')).toBeInTheDocument();
    expect(screen.getByText('/about/our-story')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Public URL' })).toHaveValue('/about/our-story');
    expect(screen.getByRole('textbox', { name: /^Label/ })).toHaveValue('Company');
    expect(screen.getByRole('switch', { name: 'Visible in menu' })).toBeChecked();
    expect(document.body.textContent).not.toMatch(UUID);
    expect(screen.queryByText('Target UUID')).not.toBeInTheDocument();
  });

  it('adds the UIDs and the target UUID in developer mode', async () => {
    await setup({ nav: 'n-company', dev: '1' });

    expect(screen.getByText('Target UUID')).toBeInTheDocument();
    expect(document.body.textContent).toMatch(UUID);
    expect(navTree()).toHaveTextContent('nav_company');
  });

  it('opens the page picker from the query and changes the target', async () => {
    const url = watchQuery();
    await setup({ nav: 'n-company', navpicker: '1' });

    const dialog = await screen.findByRole('dialog', { name: 'Choose the target page' });
    expect(url()).toContain('navpicker=1');
    // The current target is selected and previewed.
    await waitFor(() => expect(within(dialog).getByRole('status')).toHaveTextContent('/about/our-story'));
    const pages = within(dialog).getByRole('tree', { name: 'Pages' });
    fireEvent.click(rowNamed('Contact', pages));
    expect(within(dialog).getByRole('status')).toHaveTextContent('Contact');
    expect(within(dialog).getByRole('status')).toHaveTextContent('/contact');
    // A folder can't be a target.
    fireEvent.click(rowNamed('Shop', pages));
    expect(within(dialog).getByRole('button', { name: 'OK' })).toBeDisabled();
    fireEvent.click(rowNamed('Contact', pages));
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'Public URL' })).toHaveValue('/contact');
    expect(rowNamed('Company', navTree()).querySelector('.sf-tree__secondary')).toHaveTextContent('→ /contact');
    expect(url()).not.toContain('navpicker');

    // "Change target…" opens it again.
    fireEvent.click(screen.getByRole('button', { name: 'Change target…' }));
    expect(await screen.findByRole('dialog', { name: 'Choose the target page' })).toBeInTheDocument();
  });

  it('reorders a menu item among its siblings with Alt+↑ and undoes it', async () => {
    await setup();
    const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');

    const news = rowNamed('News');
    news.focus();
    fireEvent.focusIn(news);
    fireEvent.keyDown(news, { key: 'ArrowUp', altKey: true });

    await waitFor(() => expect(names()).toEqual(['Home', 'Coffee', 'News', 'Roastery', 'Contact', 'Imprint']));
    expect(undo).toHaveBeenCalledWith('Moved “News” to position 3 of 6', expect.any(Function));

    undo.mock.calls[0][1]();
    await waitFor(() => expect(names()).toEqual(['Home', 'Coffee', 'Roastery', 'News', 'Contact', 'Imprint']));
  });

  it('creates a menu item in the selected folder', async () => {
    await setup({ nav: 'n-roastery' });

    fireEvent.click(screen.getByRole('button', { name: 'New menu item' }));
    expect(h1()).toHaveTextContent('New menu item');
    expect(screen.getByText('No target page yet')).toBeInTheDocument();
    await waitFor(() => expect(names()).toContain('New menu item'));
  });

  it('mutes a hidden entry in the tree next to its Hidden marker (decision 168)', async () => {
    await setup();
    const imprint = rowNamed('Imprint');
    expect(imprint.querySelector('.sf-tree__name--muted')).toBeTruthy();
    expect(rowNamed('Contact').querySelector('.sf-tree__name--muted')).toBeNull();
  });

  it('has a sortable Visible in menu column and bulk Show in menu / Hide from menu on the selected rows, with Undo', async () => {
    await setup({ nav: 'n-coffee' });
    const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
    const table = screen.getByRole('grid', { name: 'Menu items in Coffee' });
    fireEvent.click(within(table).getByRole('button', { name: /Visible in menu/ }));
    expect(within(table).getByRole('columnheader', { name: /Visible in menu/ })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(within(table).getByRole('button', { name: /Visible in menu/ }));
    fireEvent.click(within(table).getByRole('button', { name: /Visible in menu/ }));

    const rows = within(table).getAllByRole('row').slice(1);
    fireEvent.click(within(rows[0]).getByRole('checkbox'));
    fireEvent.click(within(rows[1]).getByRole('checkbox'));
    fireEvent.click(await screen.findByRole('button', { name: 'Hide from menu' }));

    await waitFor(() => expect(within(rows[0]).getByText('Hidden from menu')).toBeInTheDocument());
    expect(within(rows[1]).getByText('Hidden from menu')).toBeInTheDocument();
    expect(within(rowNamed('Single origins')).getByText('Hidden from menu')).toBeInTheDocument();
    expect(undo).toHaveBeenCalledWith('2 entries are hidden from the menu.', expect.any(Function));

    undo.mock.calls[0][1]();
    await waitFor(() => expect(within(rows[0]).getByText('In menu')).toBeInTheDocument());
    expect(within(rows[1]).getByText('In menu')).toBeInTheDocument();
  });

  it('hides a folder from its ⋮ menu', async () => {
    await setup({ nav: 'n-coffee' });
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Hide from menu/ }));
    await waitFor(() => expect(within(rowNamed('Coffee')).getByText('Hidden from menu')).toBeInTheDocument());
  });

  it('changes the entry page in a drawer from the line, the ⋮ menu or the tree menu, with Undo', async () => {
    await setup({ nav: 'n-coffee' });
    const undo = vi.spyOn(TestBed.inject(ToastService), 'undo');
    fireEvent.click(within(entryLine()).getByRole('button', { name: 'Change…' }));

    const drawer = await screen.findByRole('dialog', { name: 'Entry page — Coffee' });
    expect(within(drawer).getByRole('radio', { name: /^Single origins/ })).toBeChecked();
    expect(within(drawer).getByText('Menu item · leads to /shop/single-origins')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('radio', { name: /^Blends/ }));
    fireEvent.click(within(drawer).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(entryLine()).toHaveTextContent('Blends');
    expect(undo).toHaveBeenCalledWith('“Blends” is now the entry page.', expect.any(Function));
    undo.mock.calls[0][1]();
    await waitFor(() => expect(entryLine()).toHaveTextContent('Single origins'));

    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Entry page…/ }));
    expect(await screen.findByRole('dialog', { name: 'Entry page — Coffee' })).toBeInTheDocument();
  });

  it('opens the "All navigation" wrapper from the tree title: its entry page and the top level, nothing to rename or delete', async () => {
    await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Open All navigation, with the menu’s entry page' }));

    expect(h1()).toHaveTextContent('All navigation');
    expect(entryLine()).toHaveTextContent('Home');
    const table = screen.getByRole('grid', { name: 'Menu items in All navigation' });
    expect(within(table).getAllByRole('row').slice(1)).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(await screen.findByRole('menuitem', { name: /^Entry page…/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Rename/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^Hide from menu/ })).not.toBeInTheDocument();
  });

  describe('menus (the app’s, announce only)', () => {
    afterEach(() => {
      TestBed.inject(ContextMenuService).close();
      TestBed.inject(TreeClipboardService).clear();
      TestBed.inject(ToastService).clear();
    });

    it('offers the app’s entries on a folder in the tree, in its order', async () => {
      await setup();
      fireEvent.contextMenu(rowNamed('Coffee'), { clientX: 40, clientY: 40 });

      expect(menuLabels()).toEqual([
        'New folder',
        'Rename',
        'Cut',
        'Paste',
        'Move to…',
        'New menu item',
        'Entry page…',
        'Hide from menu',
        'Add to favorites',
        'Release…',
        'Delete',
      ]);
    });

    it('offers Copy and Open the page on an item, and Show in menu on a hidden one', async () => {
      await setup();
      fireEvent.contextMenu(rowNamed('Contact'), { clientX: 40, clientY: 40 });
      expect(menuLabels()).toEqual(['Rename', 'Cut', 'Copy', 'Paste', 'Move to…', 'Hide from menu', 'Open the page', 'Add to favorites', 'Release…', 'Delete']);

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(rowNamed('Imprint'), { clientX: 40, clientY: 40 });
      expect(menuLabels()).toContain('Show in menu');
      expect(menuLabels()).not.toContain('Hide from menu');
    });

    it('toggles the favorite and says so', async () => {
      await setup();
      fireEvent.contextMenu(rowNamed('Contact'), { clientX: 40, clientY: 40 });
      choose('Add to favorites');
      expect(lastToast()?.message).toBe('“Contact” added to your favorites.');

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(rowNamed('Contact'), { clientX: 40, clientY: 40 });
      expect(menuLabels()).toContain('Remove from favorites');
    });

    it('releases what is pending with an Undo, and says so when nothing is', async () => {
      await setup();
      fireEvent.contextMenu(rowNamed('Contact'), { clientX: 40, clientY: 40 });
      choose('Release…');
      expect(lastToast()?.message).toBe('Released “Contact” (prototype — nothing was published).');
      expect(lastToast()?.action).toBeDefined();

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(rowNamed('Contact'), { clientX: 40, clientY: 40 });
      choose('Release…');
      expect(lastToast()?.message).toBe('Nothing here is waiting to be released.');

      // Home was released from the start: the item is enabled and answers with the info toast.
      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(rowNamed('Home'), { clientX: 40, clientY: 40 });
      expect(menu().find((item) => item.label === 'Release…')?.disabled).toBeFalsy();
      choose('Release…');
      expect(lastToast()?.message).toBe('Nothing here is waiting to be released.');
    });

    it('offers New menu item and New folder on empty space in the tree, and opens the top level on a click', async () => {
      const { container } = await setup({ nav: 'n-contact' });
      const viewport = container.querySelector<HTMLElement>('.sf-tree__viewport')!;

      fireEvent.contextMenu(viewport, { clientX: 40, clientY: 400 });
      expect(menuLabels()).toEqual(['New menu item', 'New folder']);

      fireEvent.click(viewport);
      expect(h1()).toHaveTextContent('All navigation');
    });

    it('opens the folder table’s row menu: Open, the tree’s entries and Delete…', async () => {
      await setup({ nav: 'n-coffee' });
      fireEvent.contextMenu(tableRow('Blends'), { clientX: 400, clientY: 300 });

      expect(menuLabels()).toEqual([
        'Open',
        'Rename…',
        'Cut',
        'Copy',
        'Paste',
        'Move to…',
        'Hide from menu',
        'Open the page',
        'Add to favorites',
        'Release…',
        'Delete…',
      ]);
      choose('Open');
      await waitFor(() => expect(h1()).toHaveTextContent('Blends'));
    });

    it('has New folder and New menu item on a folder row, and no Copy', async () => {
      await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Open All navigation, with the menu’s entry page' }));
      fireEvent.contextMenu(tableRow('Roastery'), { clientX: 400, clientY: 300 });

      expect(menuLabels()).toEqual([
        'Open',
        'New folder',
        'Rename…',
        'Cut',
        'Paste',
        'Move to…',
        'New menu item',
        'Entry page…',
        'Hide from menu',
        'Add to favorites',
        'Release…',
        'Delete…',
      ]);
    });

    it('shares the clipboard with the tree: Cut in a row, Paste onto a folder row moves it, with Undo', async () => {
      await setup({ nav: 'n-coffee' });
      fireEvent.contextMenu(tableRow('Blends'), { clientX: 400, clientY: 300 });
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBe(true);
      choose('Cut');

      // The tree's own Paste is enabled on a folder now.
      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(rowNamed('Roastery'), { clientX: 40, clientY: 40 });
      expect(menu().find((item) => item.label === 'Paste')?.disabled).toBeFalsy();
      TestBed.inject(ContextMenuService).close();

      fireEvent.click(screen.getByRole('button', { name: 'Open All navigation, with the menu’s entry page' }));
      fireEvent.contextMenu(tableRow('Roastery'), { clientX: 400, clientY: 300 });
      choose('Paste');
      expect(lastToast()?.message).toContain('Moved “Blends” to Roastery');
      fireEvent.click(rowNamed('Roastery'));
      expect(within(screen.getByRole('grid')).getByText('Blends')).toBeInTheDocument();
    });

    it('copies an item to the clipboard and announces a paste, folders cannot be copied', async () => {
      await setup({ nav: 'n-coffee' });
      fireEvent.contextMenu(tableRow('Blends'), { clientX: 400, clientY: 300 });
      choose('Copy');
      expect(TestBed.inject(TreeClipboardService).nodes()?.mode).toBe('copy');

      TestBed.inject(ContextMenuService).close();
      fireEvent.contextMenu(tableRow('Equipment'), { clientX: 400, clientY: 300 });
      choose('Paste');
      expect(lastToast()?.message).toBe('Copied “Blends” (prototype — nothing was copied).');
    });

    it('offers the bulk actions on several rows, with Delete after a separator, and acts on the selection', async () => {
      await setup({ nav: 'n-coffee' });
      const table = screen.getByRole('grid');
      fireEvent.click(within(tableRow('Blends')).getByRole('checkbox'));
      fireEvent.click(within(tableRow('Equipment')).getByRole('checkbox'));

      fireEvent.contextMenu(tableRow('Blends'), { clientX: 400, clientY: 300 });
      expect(menuLabels()).toEqual(['Move', 'Copy', 'Release…', 'Show in menu', 'Hide from menu', 'Delete']);
      choose('Hide from menu');
      await waitFor(() => expect(within(tableRow('Equipment')).getByText('Hidden from menu')).toBeInTheDocument());
      expect(within(tableRow('Blends')).getByText('Hidden from menu')).toBeInTheDocument();
      expect(table).toBeInTheDocument();
    });

    it('deletes the selected rows from the bulk bar with an Undo', async () => {
      await setup({ nav: 'n-coffee' });
      fireEvent.click(within(tableRow('Blends')).getByRole('checkbox'));
      fireEvent.click(within(tableRow('Equipment')).getByRole('checkbox'));
      fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(within(screen.getByRole('grid')).queryByText('Blends')).toBeNull());
      expect(lastToast()?.message).toBe('Deleted 2 entries');
      lastToast()!.action!.run();
      await waitFor(() => expect(within(screen.getByRole('grid')).getByText('Blends')).toBeInTheDocument());
    });

    it('offers New menu item on empty space in the table and creates it in the open folder', async () => {
      await setup({ nav: 'n-coffee' });
      fireEvent.contextMenu(screen.getByRole('grid').querySelector('.sf-data-table__scroller') ?? screen.getByRole('grid'), { clientX: 400, clientY: 500 });
      expect(menuLabels()).toEqual(['New menu item']);
      choose('New menu item');
      await waitFor(() => expect(h1()).toHaveTextContent('New menu item'));
    });

    it('shows folder icons in the accent colour in the table', async () => {
      await setup();
      fireEvent.click(screen.getByRole('button', { name: 'Open All navigation, with the menu’s entry page' }));
      expect(tableRow('Coffee').querySelector('.cell-label__icon')).toHaveClass('is-folder');
      expect(tableRow('Contact').querySelector('.cell-label__icon')).not.toHaveClass('is-folder');
    });
  });
});
