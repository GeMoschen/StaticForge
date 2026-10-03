import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { ToastService } from '../../../core/ui/toast.service';
import { ContextMenuService } from '../../../shared/services/context-menu.service';
import { SampleScreenComponent } from './sample-screen.component';

/** The Content area's review states of gate round 11 (M35.20): what the app does beyond the signed-off sample. */
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

const h1 = () => screen.getByRole('heading', { level: 1 });
const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);
const menuLabels = () => Array.from(document.querySelectorAll('.sf-menu__label')).map((label) => label.textContent?.trim());
const contextLabels = () => TestBed.inject(ContextMenuService).state()?.items.map((item) => item.label);
const conditions = () => screen.getByRole('group', { name: 'Conditions' });
const sortKeys = () => screen.getByRole('group', { name: 'Sort order' });

/** Picks an entry of the open context menu (it is rendered by the shared service). */
function chooseContext(label: string): void {
  const item = TestBed.inject(ContextMenuService)
    .state()
    ?.items.find((entry) => entry.label === label);
  expect(item).toBeDefined();
  item!.action?.();
}

async function openMore(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'More actions' }));
}

afterEach(() => {
  delete document.documentElement.dataset['theme'];
  delete document.documentElement.dataset['density'];
  TestBed.inject(ToastService).clear();
});

describe('folder view (gate round 11)', () => {
  it('has a Status column with a chip per language, folders combining what lies inside', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    const grid = screen.getByRole('grid', { name: 'Contents of Shop' });

    expect(within(grid).getByRole('columnheader', { name: /Status/ })).toBeInTheDocument();
    const row = within(grid).getByText('Roastery tours').closest('tr')!;
    expect(within(row).getByText('DE')).toBeInTheDocument();
    expect(within(row).getByText('EN')).toBeInTheDocument();
  });

  it('has Rename, Move and Delete in the folder’s menu (no Used by), and none at the top level', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    await openMore();
    expect(menuLabels()).toEqual(['Rename', 'Move…', 'Delete…']);
  });

  it('has no menu at the top level of the store', async () => {
    await setup({ area: 'content' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('opens the Rename dialog with a UID section in developer mode only', async () => {
    await setup({ area: 'content', view: 'contentfolder', dialog: 'rename' });
    const dialog = await screen.findByRole('dialog', { name: 'Rename “Shop”' });
    expect(within(dialog).getByRole('textbox', { name: /Name/ })).toHaveValue('Shop');
    expect(within(dialog).getByRole('textbox', { name: /UID/ })).toHaveValue('shop');
    expect(within(dialog).getByRole('button', { name: 'Save' })).toBeDisabled();

    fireEvent.input(within(dialog).getByRole('textbox', { name: /Name/ }), { target: { value: 'Webshop' } });
    fireEvent.click(await waitFor(() => {
      const save = within(dialog).getByRole('button', { name: 'Save' });
      expect(save).not.toBeDisabled();
      return save;
    }));
    await waitFor(() => expect(lastToast()?.message).toContain('Renamed to “Webshop”'));
  });

  it('leaves the UID out of the Rename dialog in the editor view', async () => {
    await setup({ area: 'content', view: 'contentfolder', dialog: 'rename', dev: '0' });
    const dialog = await screen.findByRole('dialog', { name: 'Rename “Shop”' });
    expect(within(dialog).queryByRole('textbox', { name: /UID/ })).toBeNull();
  });

  it('moves a folder through the folder dialog: its own place and what lies inside are not choosable, Move waits for a target', async () => {
    await setup({ area: 'content', view: 'contentfolder', dialog: 'move' });
    const dialog = await screen.findByRole('dialog', { name: 'Move “Shop” to…' });
    const move = within(dialog).getByRole('button', { name: 'Move' });

    expect(move).toHaveAttribute('aria-disabled', 'true');
    expect(await within(dialog).findByText('Current location')).toBeInTheDocument();
    fireEvent.click(await within(dialog).findByRole('treeitem', { name: /^Company/ }));
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Move' })).not.toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));

    await waitFor(() => expect(lastToast()?.message).toBe('Moved “Shop” to Company (prototype — nothing was moved).'));
    expect(lastToast()?.action).toBeDefined();
  });

  it('moves the selected rows with the bulk Move', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    const grid = screen.getByRole('grid', { name: 'Contents of Shop' });
    fireEvent.click(within(within(grid).getByText('Single origins').closest('tr')!).getByRole('checkbox'));

    fireEvent.click(await within(await screen.findByRole('group', { name: /bulk/i })).findByRole('button', { name: /Move/ }));
    expect(await screen.findByRole('dialog', { name: 'Move “Single origins” to…' })).toBeInTheDocument();
  });
});

describe('content tree menu (gate round 11)', () => {
  it('offers Move to…, New record, History and Used by on a record set, and New record set on a folder', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(await screen.findByRole('treeitem', { name: /^Shop/ }));
    const set = await screen.findByRole('treeitem', { name: /^Single origins/ });

    fireEvent.contextMenu(set, { clientX: 40, clientY: 40 });
    const labels = contextLabels();
    expect(labels).toEqual(expect.arrayContaining(['Move to…', 'New record', 'History', 'Used by']));
    expect(labels).not.toContain('New record set');
  });

  it('opens the set’s Used by drawer from the tree menu', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(await screen.findByRole('treeitem', { name: /^Shop/ }));
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /^Single origins/ }), { clientX: 40, clientY: 40 });
    chooseContext('Used by');

    const drawer = await screen.findByRole('dialog', { name: 'Used by' });
    expect(within(drawer).getByText('product_list')).toBeInTheDocument();
  });

  it('opens the folder Move dialog from Move to…', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(await screen.findByRole('treeitem', { name: /^Shop/ }));
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /^Single origins/ }), { clientX: 40, clientY: 40 });
    chooseContext('Move to…');

    expect(await screen.findByRole('dialog', { name: 'Move “Single origins” to…' })).toBeInTheDocument();
  });
});

describe('record set: the records shown (gate round 11)', () => {
  const rowCount = () => within(screen.getByRole('grid', { name: 'Records of Single origins' })).getAllByRole('row').length - 1;

  it('shows the records the filter selects and switches to all records, marking the ones the filter leaves out', async () => {
    await setup({ view: 'recordset' });
    const modes = screen.getByRole('radiogroup', { name: 'Records shown' });
    expect(within(modes).getByRole('radio', { name: 'Shown by the filter' })).toBeChecked();
    expect(rowCount()).toBe(3);
    expect(screen.queryAllByText('Not shown on the site: the filter leaves this record out.')).toHaveLength(0);

    fireEvent.click(within(modes).getByRole('radio', { name: 'All records' }));

    await waitFor(() => expect(rowCount()).toBe(9));
    expect(screen.getAllByText('Not shown on the site: the filter leaves this record out.')).toHaveLength(6);
  });

  it('starts on all records with show=all', async () => {
    await setup({ view: 'recordset', show: 'all' });
    expect(within(screen.getByRole('radiogroup', { name: 'Records shown' })).getByRole('radio', { name: 'All records' })).toBeChecked();
    await waitFor(() => expect(rowCount()).toBe(9));
  });

  it('follows the saved filter: an edit changes the count at once and the table only on Save filter', async () => {
    await setup({ view: 'recordset' });
    fireEvent.click(within(conditions()).getByRole('button', { name: 'Remove condition 2 (Stock)' }));
    await waitFor(() => expect(screen.getByText('4 of 9 records')).toBeInTheDocument());
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
    expect(rowCount()).toBe(3);

    fireEvent.click(screen.getByRole('button', { name: 'Save filter' }));
    await waitFor(() => expect(screen.queryByText('Unsaved')).not.toBeInTheDocument());
    expect(rowCount()).toBe(4);
    expect(lastToast()?.message).toContain('Filter saved');
  });

  it('reverts an unsaved edit', async () => {
    await setup({ view: 'recordset' });
    fireEvent.click(within(conditions()).getByRole('button', { name: 'Remove condition 2 (Stock)' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revert' }));

    await waitFor(() => expect(screen.queryByText('Unsaved')).not.toBeInTheDocument());
    expect(within(conditions()).getByRole('button', { name: 'Remove condition 2 (Stock)' })).toBeInTheDocument();
  });
});

describe('record set: filter extras (gate round 11)', () => {
  it('shows a date and a Yes/No condition, two sort keys and a limit', async () => {
    await setup({ view: 'recordset', filter: 'extras' });

    expect(h1()).toHaveTextContent('Roastery tours');
    expect(
      screen.getByText('Where date is after 2026-06-01 and sold out is no · sorted by date, then price (descending) · at most 10'),
    ).toBeInTheDocument();
    expect(screen.getByText('3 of 4 records')).toBeInTheDocument();
    expect(within(conditions()).getByRole('textbox', { name: 'Value of condition 1' })).toBeInTheDocument();
    expect(within(conditions()).getByRole('combobox', { name: 'Value of condition 2' })).toHaveDisplayValue(/^\s*No\s*$/);
    expect(within(conditions()).getByRole('combobox', { name: 'Operator of condition 1' })).toHaveDisplayValue(/^\s*is after\s*$/);
    expect(within(sortKeys()).getByRole('combobox', { name: 'Field of sort key 1' })).toHaveDisplayValue(/^\s*Date\s*$/);
    expect(within(sortKeys()).getByRole('combobox', { name: 'Field of sort key 2' })).toHaveDisplayValue(/^\s*Price\s*$/);
    expect(screen.getByRole('spinbutton', { name: 'Show at most' })).toHaveValue(10);
    expect(screen.getByRole('spinbutton', { name: 'Skip first' })).toHaveValue(null);
  });

  it('reorders the sort keys and adds and removes one', async () => {
    await setup({ view: 'recordset', filter: 'extras' });

    fireEvent.click(within(sortKeys()).getByRole('button', { name: 'Move sort key 1 down' }));
    await waitFor(() =>
      expect(screen.getByText(/sorted by price \(descending\), then date/)).toBeInTheDocument(),
    );
    fireEvent.click(within(sortKeys()).getByRole('button', { name: 'Remove sort key 1' }));
    await waitFor(() => expect(screen.getByText(/sorted by date ·/)).toBeInTheDocument());
    fireEvent.click(within(sortKeys()).getByRole('button', { name: 'Add sort key' }));
    await waitFor(() => expect(within(sortKeys()).getByRole('combobox', { name: 'Field of sort key 2' })).toBeInTheDocument());
  });

  it('cuts the list with offset and limit: the count says how many the set shows', async () => {
    await setup({ view: 'recordset', filter: 'extras' });

    fireEvent.input(screen.getByRole('spinbutton', { name: 'Show at most' }), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByText('3 of 4 records · the set shows 2')).toBeInTheDocument());
    expect(screen.getByText(/at most 2/)).toBeInTheDocument();
  });

  it('marks Spring cupping as left out of the set in All records', async () => {
    await setup({ view: 'recordset', filter: 'extras', show: 'all' });

    await waitFor(() => expect(screen.getAllByText('Not shown on the site: the filter leaves this record out.')).toHaveLength(1));
    const row = screen.getByText('Spring cupping').closest('tr')!;
    expect(within(row).getByText('Not shown on the site: the filter leaves this record out.')).toBeInTheDocument();
  });
});

describe('record set: a stored expression the builder cannot show (gate round 11)', () => {
  it('shows the expression, steps the builder aside and offers Clear filter', async () => {
    await setup({ view: 'recordset', filter: 'custom' });

    expect(screen.getByText(/This filter is an expression the builder can’t show/)).toBeInTheDocument();
    expect(screen.getByText("Where roast == 'dark' || stock > 50 · sorted by name")).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Expression' })).toHaveValue("roast == 'dark' || stock > 50");
    expect(screen.queryByRole('button', { name: 'Add condition' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Conditions' })).toBeNull();
    // The sort keys, offset and limit stay.
    expect(screen.getByRole('group', { name: 'Sort order' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filter' }));

    expect(await screen.findByRole('button', { name: 'Add condition' })).toBeInTheDocument();
    expect(screen.getByText('9 of 9 records')).toBeInTheDocument();
    expect(screen.getByText('Unsaved')).toBeInTheDocument();
  });

  it('quotes the expression in the panel in the editor view, where there is no expression field', async () => {
    await setup({ view: 'recordset', filter: 'custom', dev: '0' });

    expect(screen.queryByRole('textbox', { name: 'Expression' })).toBeNull();
    expect(screen.getByText("roast == 'dark' || stock > 50", { selector: 'code' })).toBeInTheDocument();
  });
});

describe('record set: Use as set filter (gate round 11)', () => {
  const useButton = () => screen.getByRole('button', { name: 'Use as set filter' });

  it('is disabled until the table has an expression filter or a header sort', async () => {
    await setup({ view: 'recordset' });
    expect(useButton()).toBeDisabled();

    fireEvent.input(screen.getByRole('textbox', { name: 'Expression filter' }), { target: { value: "roast == 'dark'" } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(useButton()).not.toBeDisabled());
  });

  it('copies the table’s expression and sort into the draft filter, unsaved', async () => {
    await setup({ view: 'recordset' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Expression filter' }), { target: { value: "roast == 'dark'" } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    fireEvent.click(await waitFor(() => {
      expect(useButton()).not.toBeDisabled();
      return useButton();
    }));

    await waitFor(() => expect(screen.getByText('Unsaved')).toBeInTheDocument());
    expect(screen.getByText(/^Where roast is dark · sorted by name/)).toBeInTheDocument();
    expect(within(conditions()).getAllByRole('button', { name: /Remove condition/ })).toHaveLength(1);
  });

  it('refuses an expression the sample cannot read', async () => {
    await setup({ view: 'recordset' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Expression filter' }), { target: { value: 'nonsense ==' } });
    expect(screen.getByRole('textbox', { name: 'Expression filter' })).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('record set: menu, Rename, Move and Used by (gate round 11)', () => {
  it('has History, Used by, Rename…, Move… and Delete…', async () => {
    await setup({ view: 'recordset' });
    await openMore();
    expect(menuLabels()).toEqual(['History', 'Used by', 'Rename…', 'Move…', 'Delete…']);
  });

  it('opens the Rename dialog from the menu', async () => {
    await setup({ view: 'recordset' });
    await openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename “Single origins”' });
    expect(within(dialog).getByRole('textbox', { name: /UID/ })).toHaveValue('single_origins');
  });

  it('opens the folder Move dialog from the menu, with the current folder marked', async () => {
    await setup({ view: 'recordset' });
    await openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: /Move/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Move “Single origins” to…' });
    expect(await within(dialog).findByText('Current location')).toBeInTheDocument();
  });

  it('lists what uses the set in a drawer, and says so when nothing does', async () => {
    await setup({ view: 'recordset', panel: 'usedby' });
    const drawer = await screen.findByRole('dialog', { name: 'Used by' });
    expect(within(drawer).getByText('product_list')).toBeInTheDocument();
    expect(within(drawer).getByText('Page')).toBeInTheDocument();
  });

  it('shows the empty state for a set nothing uses', async () => {
    await setup({ area: 'content', view: 'contentfolder' });
    fireEvent.click(await screen.findByRole('treeitem', { name: /^Shop/ }));
    fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /^Espresso blends/ }), { clientX: 40, clientY: 40 });
    chooseContext('Used by');
    expect(await screen.findByText('Not used yet')).toBeInTheDocument();
  });
});

describe('record set: bulk Move of records (gate round 11)', () => {
  it('moves the selection to another record set of the same dataset, and Undo brings it back', async () => {
    await setup({ view: 'recordset' });
    const bulk = await screen.findByRole('group', { name: /bulk/i });

    fireEvent.click(within(bulk).getByRole('button', { name: /Move/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 records to…' });
    expect(within(dialog).getByText(/another record set of the same dataset/)).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Espresso blends/ })).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Spring specials/ })).toBeInTheDocument();
    expect(within(dialog).queryByRole('radio', { name: /Roastery tours/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Move' })).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(within(dialog).getByRole('radio', { name: /Espresso blends/ }));
    fireEvent.click(await waitFor(() => {
      const move = within(dialog).getByRole('button', { name: 'Move' });
      expect(move).not.toHaveAttribute('aria-disabled', 'true');
      return move;
    }));

    await waitFor(() => expect(screen.getByText('1 of 7 records')).toBeInTheDocument());
    expect(lastToast()?.message).toBe('Moved 2 records to Espresso blends.');
    lastToast()!.action!.run();
    await waitFor(() => expect(screen.getByText('3 of 9 records')).toBeInTheDocument());
  });

  it('says there is nowhere to move to when the dataset has one set only', async () => {
    await setup({ view: 'recordset', filter: 'extras', dialog: 'bulkmove' });
    const dialog = await screen.findByRole('dialog', { name: /^Move 2 records to…/ });
    expect(within(dialog).getByText('There is no other record set of this dataset to move to.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Move' })).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('record editor (gate round 11)', () => {
  it('has Save now, Move…, Copy link, Used by… and Delete… in the menu', async () => {
    await setup({ view: 'record' });
    await openMore();
    expect(menuLabels()).toEqual(['Save now', 'Move…', 'Copy link', 'Used by…', 'Delete…']);
  });

  it('shows Checks with a count in the header and lists the findings, most severe first', async () => {
    await setup({ view: 'record', panel: 'checks' });

    const drawer = await screen.findByRole('dialog', { name: 'Checks and usage' });
    expect(within(drawer).getByRole('tab', { name: /Checks/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(drawer).getByText('No problems found')).toBeInTheDocument();
  });

  it('counts a problem as soon as a value breaks a rule', async () => {
    await setup({ view: 'record' });
    const checks = screen.getByRole('button', { name: /^Checks/ });
    expect(within(checks).queryByText('1')).toBeNull();

    fireEvent.input(screen.getByRole('spinbutton', { name: /Stock/ }), { target: { value: '2' } });
    await waitFor(() => expect(within(screen.getByRole('button', { name: /^Checks/ })).getByText('1')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /^Checks/ }));
    const drawer = await screen.findByRole('dialog', { name: 'Checks and usage' });
    expect(within(drawer).getByText(/Only 2 bags left/)).toBeInTheDocument();
  });

  it('lists what uses the record in the Used by tab', async () => {
    await setup({ view: 'record', panel: 'usedby' });
    const drawer = await screen.findByRole('dialog', { name: 'Checks and usage' });
    expect(within(drawer).getByRole('tab', { name: /Used by/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(drawer).getByText('Spring harvest arrives')).toBeInTheDocument();
  });

  it('asks about the pages that use a record before deleting it', async () => {
    await setup({ view: 'record' });
    await openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/It is used by 2 pages or templates\. Delete it anyway\?/)).toBeInTheDocument();
  });

  it('shows a deleted record with a banner and Restore, its form locked', async () => {
    await setup({ view: 'record', state: 'deleted' });

    expect(await screen.findByText('This record is deleted')).toBeInTheDocument();
    expect(screen.getByText('Restore it to edit it again.')).toBeInTheDocument();
    expect(document.querySelector('.record__fields')).toHaveAttribute('inert');
    await openMore();
    expect(screen.getByRole('menuitem', { name: 'Save now' })).toHaveAttribute('aria-disabled', 'true');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByText('This record is deleted')).toBeNull());
    expect(document.querySelector('.record__fields')).not.toHaveAttribute('inert');
    expect(lastToast()?.message).toContain('Record restored');
  });

  it('says when the record does not exist, and leads back to the content', async () => {
    await setup({ view: 'record', state: 'notfound' });

    expect(await screen.findByText('Record not found')).toBeInTheDocument();
    expect(screen.getByText('It may have been deleted, or the link is wrong.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to content' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Content' })).toBeInTheDocument());
  });

  it('says when the record did not exist at that revision, and leads back to now', async () => {
    await setup({ view: 'record', state: 'revision' });

    expect(await screen.findByText('Not there yet')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to now' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Yirgacheffe Konga 250 g' })).toBeInTheDocument());
  });

  it('says when the record could not be loaded, with Try again', async () => {
    await setup({ view: 'record', state: 'error' });

    expect(await screen.findByText('Could not load the record')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Yirgacheffe Konga 250 g' })).toBeInTheDocument());
  });

  it('moves the record to another record set of its dataset', async () => {
    await setup({ view: 'record' });
    await openMore();
    fireEvent.click(screen.getByRole('menuitem', { name: /Move/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Move “Yirgacheffe Konga 250 g” to…' });

    fireEvent.click(within(dialog).getByRole('radio', { name: /Espresso blends/ }));
    fireEvent.click(await waitFor(() => {
      const move = within(dialog).getByRole('button', { name: 'Move' });
      expect(move).not.toHaveAttribute('aria-disabled', 'true');
      return move;
    }));

    await waitFor(() => expect(lastToast()?.message).toBe('Moved “Yirgacheffe Konga 250 g” to Espresso blends.'));
    expect(h1()).toHaveTextContent('Yirgacheffe Konga 250 g');
  });
});
