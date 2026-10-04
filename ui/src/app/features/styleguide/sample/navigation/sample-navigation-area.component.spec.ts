import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { SpyLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../core/ui/toast.service';
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
});
