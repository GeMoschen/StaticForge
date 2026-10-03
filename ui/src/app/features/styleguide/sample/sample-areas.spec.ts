import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { SampleScreenComponent } from './sample-screen.component';

/** The sample screen's catalog field, Content area and Templates area (M35.9 review round 1). */
async function setup(query: Record<string, string> = {}) {
  const result = await render(SampleScreenComponent, {
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
    ],
  });
  // The tree loads its root asynchronously.
  await screen.findAllByRole('treeitem');
  return result;
}

/** The query string the screen last wrote. */
function watchQuery(): () => string {
  const replace = vi.spyOn(TestBed.inject(Location), 'replaceState');
  return () => String(replace.mock.lastCall?.[1] ?? '');
}

const h1 = () => screen.getByRole('heading', { level: 1 });
const rail = () => screen.getByRole('navigation', { name: 'Project' });
const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
  delete document.documentElement.dataset['codePalette'];
  vi.unstubAllGlobals();
  TestBed.inject(ToastService).clear();
});

describe('page editor catalog', () => {
  const teasers = () => screen.getByRole('group', { name: 'Product teasers' });
  const preview = () => (screen.getByTitle('Preview of Spring harvest arrives') as HTMLIFrameElement).srcdoc;

  it('shows the catalog field with its cards, a nested catalog and an outline entry', async () => {
    await setup({ view: 'editor', focus: 'catalog' });

    expect(within(teasers()).getByText('4 cards')).toBeInTheDocument();
    expect(within(teasers()).getAllByRole('group', { name: 'Badges' })).toHaveLength(2);
    expect(within(teasers()).getByRole('heading', { name: /Product teaser · Yirgacheffe Konga 250 g/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('option', { name: /^Product teasers/ })).toHaveAttribute('aria-selected', 'true'));
    // The preview renders the cards in order.
    expect(preview().indexOf('Yirgacheffe Konga 250 g')).toBeLessThan(preview().indexOf('Kaffee-Journal'));
    expect(preview()).toContain('New harvest');
  });

  it('removes a card with Undo and adds one, updating the preview', async () => {
    await setup({ view: 'editor' });

    fireEvent.click(within(teasers()).getByRole('button', { name: 'Actions for Quote' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    await waitFor(() => expect(within(teasers()).getByText('3 cards')).toBeInTheDocument());
    expect(preview()).not.toContain('Kaffee-Journal');

    const toast = lastToast()!;
    expect(toast.message).toContain('Removed Quote');
    toast.action!.run();
    await waitFor(() => expect(within(teasers()).getByText('4 cards')).toBeInTheDocument());
    expect(preview()).toContain('Kaffee-Journal');

    // The field's own "Add card" comes after those of the nested catalogs.
    fireEvent.click(within(teasers()).getAllByRole('button', { name: 'Add card' }).at(-1)!);
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Badge/ }));
    await waitFor(() => expect(within(teasers()).getByText('5 cards')).toBeInTheDocument());
  });
});

describe('areas', () => {
  it('switches areas from the rail and marks the active one', async () => {
    await setup();
    const query = watchQuery();

    fireEvent.click(within(rail()).getByRole('button', { name: 'Content' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Content'));
    expect(within(rail()).getByRole('button', { name: 'Content' })).toHaveAttribute('aria-current', 'page');
    expect(within(rail()).getByRole('button', { name: 'Pages' })).not.toHaveAttribute('aria-current');
    expect(await screen.findByRole('tree', { name: 'Content' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Contents of Content' })).toBeInTheDocument();
    await waitFor(() => expect(query()).toContain('area=content'));

    fireEvent.click(within(rail()).getByRole('button', { name: 'Templates' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Templates'));
    expect(await screen.findByRole('tree', { name: 'Templates' })).toBeInTheDocument();

    fireEvent.click(within(rail()).getByRole('button', { name: 'Pages' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Pages'));
  });

  it('renders the self-contained areas in the main region', async () => {
    await setup();
    watchQuery();

    fireEvent.click(within(rail()).getByRole('button', { name: 'Media' }));
    await waitFor(() => expect(screen.getByRole('main').querySelector('sf-sample-media-area')).not.toBeNull());
    expect(within(rail()).getByRole('button', { name: 'Media' })).toHaveAttribute('aria-current', 'page');
    // The screen writes its parameters; the area adds its own (merged in the app, where the path isn't the root).
    const replace = vi.mocked(TestBed.inject(Location).replaceState);
    await waitFor(() => expect(replace.mock.calls.some(([, q]) => String(q).includes('area=media'))).toBe(true));

    fireEvent.click(within(rail()).getByRole('button', { name: 'Navigation' }));
    await waitFor(() => expect(screen.getByRole('main').querySelector('sf-sample-navigation-area')).not.toBeNull());
    fireEvent.click(within(rail()).getByRole('button', { name: /^Changes/ }));
    await waitFor(() => expect(screen.getByRole('main').querySelector('sf-sample-changes-area')).not.toBeNull());
    fireEvent.click(within(rail()).getByRole('button', { name: 'Schedules' }));
    await waitFor(() => expect(screen.getByRole('main').querySelector('sf-sample-schedules-area')).not.toBeNull());
    fireEvent.click(within(rail()).getByRole('button', { name: 'Globals' }));
    await waitFor(() => expect(screen.getByRole('main').querySelector('sf-sample-globals-area')).not.toBeNull());
    fireEvent.click(within(rail()).getByRole('button', { name: 'Publishing' }));
    await waitFor(() => expect(screen.getByRole('main').querySelector('sf-sample-publishing-area')).not.toBeNull());
  });

  it('opens a content folder with the dataset filter applied', async () => {
    await setup({ area: 'content', view: 'contentfolder' });

    expect(h1()).toHaveTextContent('Shop');
    expect(await screen.findByText(/Dataset: Products/)).toBeInTheDocument();
    const grid = screen.getByRole('grid', { name: 'Contents of Shop' });
    await waitFor(() => expect(within(grid).queryByText('Roastery tours')).not.toBeInTheDocument());
    expect(within(grid).getByText('Single origins')).toBeInTheDocument();
  });

  describe('the New record set dialog (gate round 10, awaiting sign-off)', () => {
    const dialog = () => screen.getByRole('dialog', { name: 'New record set' });

    it('opens from the folder header with no dataset chosen: Create stays disabled, saying why, until a name and a dataset are given', async () => {
      await setup({ area: 'content', view: 'contentfolder' });

      fireEvent.click(screen.getByRole('button', { name: 'New record set' }));
      await screen.findByRole('dialog', { name: 'New record set' });

      const dataset = within(dialog()).getByLabelText(/Dataset/) as HTMLSelectElement;
      expect(dataset.options[dataset.selectedIndex].textContent?.trim()).toBe('Choose a dataset');
      expect(within(dialog()).getByText(/The dataset can’t be changed after the set is created/)).toBeInTheDocument();
      const create = within(dialog()).getByRole('button', { name: 'Create' });
      expect(create).toHaveAttribute('aria-disabled', 'true');

      fireEvent.input(within(dialog()).getByLabelText(/Name/), { target: { value: 'Spring specials' } });
      await waitFor(() => expect(create).toHaveAttribute('aria-disabled', 'true'));

      fireEvent.change(dataset, { target: { value: '0' } });
      await waitFor(() => expect(create).not.toHaveAttribute('aria-disabled', 'true'));
      fireEvent.click(create);

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New record set' })).not.toBeInTheDocument());
      expect(lastToast()?.message).toBe('“Spring specials” would be created in Shop — nothing is saved in the prototype.');
    });

    it('asks for a name once the field was touched, and a chosen dataset alone does not enable Create', async () => {
      await setup({ area: 'content', view: 'contentfolder' });
      fireEvent.click(screen.getByRole('button', { name: 'New record set' }));
      await screen.findByRole('dialog', { name: 'New record set' });

      fireEvent.change(within(dialog()).getByLabelText(/Dataset/), { target: { value: '1' } });
      expect(within(dialog()).getByRole('button', { name: 'Create' })).toHaveAttribute('aria-disabled', 'true');
      expect(within(dialog()).queryByText('A name is required.')).not.toBeInTheDocument();
      fireEvent.input(within(dialog()).getByLabelText(/Name/), { target: { value: 'x' } });
      fireEvent.input(within(dialog()).getByLabelText(/Name/), { target: { value: '' } });

      expect(await within(dialog()).findByText('A name is required.')).toBeInTheDocument();
    });

    it('closes without creating on Cancel', async () => {
      await setup({ area: 'content', view: 'contentfolder' });
      fireEvent.click(screen.getByRole('button', { name: 'New record set' }));
      await screen.findByRole('dialog', { name: 'New record set' });

      fireEvent.click(within(dialog()).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New record set' })).not.toBeInTheDocument());
      expect(lastToast()).toBeUndefined();
    });

    it('opens from the tree’s New menu and creates in the open folder', async () => {
      await setup({ area: 'content', view: 'contentfolder' });

      fireEvent.click(screen.getByRole('button', { name: 'New' }));
      fireEvent.click(await screen.findByRole('menuitem', { name: 'New record set' }));
      await screen.findByRole('dialog', { name: 'New record set' });

      fireEvent.input(within(dialog()).getByLabelText(/Name/), { target: { value: 'Autumn' } });
      fireEvent.change(within(dialog()).getByLabelText(/Dataset/), { target: { value: '0' } });
      fireEvent.click(await waitFor(() => {
        const create = within(dialog()).getByRole('button', { name: 'Create' });
        expect(create).not.toHaveAttribute('aria-disabled', 'true');
        return create;
      }));
      await waitFor(() => expect(lastToast()?.message).toContain('in Shop'));
    });

    it('is open on arrival with newset=1, for review', async () => {
      await setup({ area: 'content', newset: '1' });
      expect(await screen.findByRole('dialog', { name: 'New record set' })).toBeInTheDocument();
    });
  });

  it('keeps the Templates area to developer mode', async () => {
    await setup({ area: 'templates', view: 'dataset', dev: '0' });

    expect(h1()).toHaveTextContent('Pages');
    expect(within(rail()).queryByRole('button', { name: 'Templates' })).not.toBeInTheDocument();
  });
});

describe('record set view', () => {
  const conditions = () => screen.getByRole('group', { name: 'Conditions' });
  const removeButtons = () => within(conditions()).queryAllByRole('button', { name: /Remove condition/ });

  it('summarises the query, shows the builder and selects two records', async () => {
    await setup({ view: 'recordset' });

    expect(h1()).toHaveTextContent('Single origins');
    expect(screen.getByText('Where roast is light and stock is greater than 0 · sorted by name')).toBeInTheDocument();
    expect(screen.getByText('3 of 9 records')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Expression' })).toHaveValue("roast == 'light' && stock > 0");
    const bulk = await screen.findByRole('group', { name: /bulk/i });
    expect(within(bulk).getByText(/2 selected/)).toBeInTheDocument();
    expect(within(bulk).getByRole('button', { name: /Release/ })).toBeInTheDocument();
  });

  it('adds and removes filter rows, which change the records', async () => {
    await setup({ view: 'recordset' });

    expect(removeButtons()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Add condition' }));
    await waitFor(() => expect(removeButtons()).toHaveLength(3));

    fireEvent.click(within(conditions()).getByRole('button', { name: 'Remove condition 1 (Roast)' }));
    await waitFor(() => expect(removeButtons()).toHaveLength(2));
    fireEvent.click(within(conditions()).getByRole('button', { name: 'Remove condition 1 (Stock)' }));
    await waitFor(() => expect(removeButtons()).toHaveLength(1));
    // The new row has no value yet: it doesn't filter.
    expect(screen.getByText('9 of 9 records')).toBeInTheDocument();
    expect(screen.getByText('All records · sorted by name')).toBeInTheDocument();
  });

  it('deletes selected records with Undo', async () => {
    await setup({ view: 'recordset' });
    const bulk = await screen.findByRole('group', { name: /bulk/i });

    fireEvent.click(within(bulk).getByRole('button', { name: /Delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete 2 items' }));
    await waitFor(() => expect(screen.getByText('1 of 7 records')).toBeInTheDocument());
    lastToast()!.action!.run();
    await waitFor(() => expect(screen.getByText('3 of 9 records')).toBeInTheDocument());
  });

  it('hides the expression in the editor view and starts collapsed when opened from the tree', async () => {
    await setup({ area: 'content', dev: '0' });

    fireEvent.click(await screen.findByRole('treeitem', { name: /^Shop/ }));
    fireEvent.click(await screen.findByRole('treeitem', { name: /^Espresso blends/ }));
    await waitFor(() => expect(h1()).toHaveTextContent('Espresso blends'));
    expect(screen.getByRole('button', { name: 'Filter' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('textbox', { name: 'Expression' })).not.toBeInTheDocument();
  });
});

describe('record editor', () => {
  it('titles the record by its display name and shows its identifiers in developer mode', async () => {
    await setup({ view: 'record' });

    expect(h1()).toHaveTextContent('Yirgacheffe Konga 250 g');
    expect(screen.getByRole('group', { name: 'Tasting notes' })).toBeInTheDocument();
    expect(screen.getByText('UUID')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Origin/ })).toHaveValue('Ethiopia');
  });

  it('hides the UUID in the editor view', async () => {
    await setup({ view: 'record', dev: '0' });

    expect(h1()).toHaveTextContent('Yirgacheffe Konga 250 g');
    expect(screen.queryByText('UUID')).not.toBeInTheDocument();
  });
});

describe('templates', () => {
  it('shows a dataset with its tabs and links to the record sets using it', async () => {
    await setup({ area: 'templates', view: 'dataset' });

    expect(h1()).toHaveTextContent('Products');
    const tabs = screen.getByRole('tablist', { name: 'Dataset sections' });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent?.trim())).toEqual(['Overview', 'Schema (CDL)', 'Rules', 'html', 'rss']);
    expect(screen.getByRole('grid', { name: 'Fields of Products' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Single origins' }));
    await waitFor(() => expect(h1()).toHaveTextContent('Single origins'));
  });

  it('opens the schema tab from the query parameters', async () => {
    await setup({ area: 'templates', view: 'dataset', tab: 'schema' });

    expect(screen.getByRole('tab', { name: 'Schema (CDL)' })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByText('products.content.cdl')).toBeInTheDocument();
  });

  it('opens both templates, from the query parameters and the tree', async () => {
    await setup({ area: 'templates', view: 'template', template: 'article' });

    expect(h1()).toHaveTextContent('Article');
    expect(screen.getByRole('navigation', { name: 'Inherits from' })).toHaveTextContent(/Base page.*Content page.*Article/);
    const cdl = screen.getByRole('tablist', { name: 'CDL sections' });
    expect(within(cdl).getAllByRole('tab')).toHaveLength(3);
    expect(within(cdl).getByRole('tab', { name: /Content/ })).toHaveTextContent('1');
    expect(screen.getByRole('tablist', { name: 'Channel templates' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('treeitem', { name: /^Section templates/ }));
    fireEvent.click(await screen.findByRole('treeitem', { name: /^Product teaser/ }));
    await waitFor(() => expect(h1()).toHaveTextContent('Product teaser'));
    expect(within(screen.getByRole('tablist', { name: 'CDL sections' })).getAllByRole('tab')).toHaveLength(2);
  });

  it('enables Save only when dirty; Ctrl+S saves', async () => {
    await setup({ area: 'templates', view: 'template', template: 'article' });
    const save = () => screen.getByRole('button', { name: 'Save' });

    expect(save()).toBeDisabled();
    fireEvent.click(within(screen.getByRole('main')).getByRole('button', { name: 'Settings' }));
    fireEvent.input(screen.getByRole('textbox', { name: /Output path/ }), { target: { value: '{folder}{uid}.{ext}' } });
    await waitFor(() => expect(save()).toBeEnabled());
    expect(screen.getByText('Add the locale placeholder: this project has two languages.')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(save()).toBeDisabled());
    expect(lastToast()?.message).toContain('Saved “Article”');
  });

  it('switches the highlighting palette, also from the query parameters', async () => {
    await setup({ area: 'templates', view: 'template', template: 'teaser', palette: 'refined' });
    const query = watchQuery();

    expect(document.documentElement.dataset['codePalette']).toBe('refined');
    fireEvent.click(screen.getByRole('radio', { name: 'Current' }));
    await waitFor(() => expect(document.documentElement.dataset['codePalette']).toBeUndefined());
    fireEvent.click(screen.getByRole('radio', { name: 'Refined' }));
    await waitFor(() => expect(query()).toContain('palette=refined'));
  });

  it('stacks the editors as tabs below 1280 px', async () => {
    vi.stubGlobal('matchMedia', (media: string) => ({ matches: false, media, addEventListener: () => {}, removeEventListener: () => {} }));
    await setup({ area: 'templates', view: 'template', template: 'article', channel: 'rss' });

    const sides = screen.getByRole('tablist', { name: 'Editors' });
    expect(screen.getByRole('tablist', { name: 'CDL sections' })).toBeInTheDocument();
    fireEvent.click(within(sides).getByRole('tab', { name: /Channels/ }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'rss' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByRole('tablist', { name: 'CDL sections' })).not.toBeInTheDocument();
  });
});
