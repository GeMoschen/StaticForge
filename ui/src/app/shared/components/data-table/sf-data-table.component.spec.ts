import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { fireEvent, render, screen, within } from '@testing-library/angular';
import { afterEach, describe, expect, it } from 'vitest';
import { PreferencesService } from '../../../core/preferences/preferences.service';
import { ContextMenuService } from '../../services/context-menu.service';
import { SfButtonComponent } from '../sf-button.component';
import type {
  SfDataTableBulkAction,
  SfDataTableBulkActionEvent,
  SfDataTableColumn,
  SfDataTableFilter,
  SfDataTableMode,
  SfDataTablePaging,
  SfDataTableQuery,
  SfDataTableSelection,
  SfDataTableSort,
} from './data-table.types';
import { SfDataTableComponent } from './sf-data-table.component';
import { SfDataTableCellDirective } from './sf-data-table-templates.directive';

interface Item {
  id: string;
  name: string;
  status: 'draft' | 'published';
  size: number;
}

const ITEMS: Item[] = [
  { id: 'a', name: 'Alpha', status: 'draft', size: 30 },
  { id: 'b', name: 'Beta', status: 'published', size: 10 },
  { id: 'c', name: 'Gamma', status: 'draft', size: 20 },
  { id: 'd', name: 'Delta', status: 'published', size: 20 },
  { id: 'e', name: 'Epsilon', status: 'draft', size: 5 },
];

const COLUMNS: SfDataTableColumn<Item>[] = [
  { id: 'name', header: 'Name', value: (r) => r.name, sortable: true, width: 200 },
  { id: 'status', header: 'Status', value: (r) => r.status, sortable: true },
  { id: 'size', header: 'Size', value: (r) => r.size, sortable: true, align: 'end' },
];

const FILTERS: SfDataTableFilter<Item>[] = [
  {
    id: 'status',
    label: 'Status',
    options: [
      { value: 'draft', label: 'Draft' },
      { value: 'published', label: 'Published' },
    ],
  },
];

/** What the next Host starts with. */
interface Config {
  rows: Item[];
  mode: SfDataTableMode;
  total: number | null;
  selectable: boolean;
  paging: SfDataTablePaging;
  pageSize: number;
  tableId: string | null;
  urlSync: string | null;
  loading: boolean;
  error: string | boolean | null;
}

const DEFAULTS: Config = {
  rows: ITEMS,
  mode: 'client',
  total: null,
  selectable: false,
  paging: 'none',
  pageSize: 50,
  tableId: null,
  urlSync: null,
  loading: false,
  error: null,
};
let config: Config = DEFAULTS;

@Component({
  standalone: true,
  imports: [SfDataTableComponent, SfDataTableCellDirective, SfButtonComponent],
  template: `
    <sf-data-table
      label="Items"
      [columns]="columns"
      [rows]="rows()"
      [mode]="mode()"
      [total]="total()"
      [selectable]="selectable()"
      [searchable]="true"
      [searchDebounce]="0"
      [filters]="filters"
      [paging]="paging()"
      [pageSize]="pageSize()"
      [tableId]="tableId()"
      [urlSync]="urlSync()"
      [loading]="loading()"
      [error]="error()"
      [bulkActions]="bulkActions"
      [rowMenu]="rowMenu"
      [emptyMenu]="emptyMenu"
      emptyClickClears
      (queryChange)="queries.push($event)"
      (sortChange)="sorts.push($event)"
      (pageChange)="pages.push($event)"
      (selectionChange)="selections.push($event)"
      (rowOpen)="opened.push($event)"
      (retry)="retries = retries + 1"
      (loadMore)="loadMores = loadMores + 1"
      (bulkAction)="bulk.push($event)"
    >
      <ng-template sfDataTableCell="status" [sfDataTableCellRows]="rows()" let-row let-index="index">
        <span class="status-cell">{{ row.status.toUpperCase() }} #{{ index }}</span>
      </ng-template>
      <sf-button sfDataTableBulkActions variant="danger" (click)="deleted = true">Delete</sf-button>
    </sf-data-table>
  `,
})
class Host {
  readonly columns = COLUMNS;
  readonly filters = FILTERS;
  readonly bulkActions: SfDataTableBulkAction<Item>[] = [{ id: 'archive', label: 'Archive' }];
  menuRows: Item[][] = [];
  readonly rowMenu = (rows: Item[]) => {
    this.menuRows.push(rows);
    return [{ label: `Open ${rows.length}`, action: () => undefined }];
  };
  readonly emptyMenu = () => [{ label: 'New item', action: () => undefined }];
  readonly rows = signal(config.rows);
  readonly mode = signal(config.mode);
  readonly total = signal(config.total);
  readonly selectable = signal(config.selectable);
  readonly paging = signal(config.paging);
  readonly pageSize = signal(config.pageSize);
  readonly tableId = signal(config.tableId);
  readonly urlSync = signal(config.urlSync);
  readonly loading = signal(config.loading);
  readonly error = signal(config.error);

  queries: SfDataTableQuery[] = [];
  sorts: (readonly SfDataTableSort[])[] = [];
  pages: number[] = [];
  selections: SfDataTableSelection<Item>[] = [];
  opened: Item[] = [];
  bulk: SfDataTableBulkActionEvent<Item>[] = [];
  retries = 0;
  loadMores = 0;
  deleted = false;
}

async function setup(overrides: Partial<Config> = {}, providers: unknown[] = []) {
  config = { ...DEFAULTS, ...overrides };
  const result = await render(Host, { providers: providers as never[] });
  return { ...result, host: result.fixture.componentInstance };
}

function dataRows(): HTMLTableRowElement[] {
  return screen.getAllByRole('row').filter((r) => r.hasAttribute('data-row-index')) as HTMLTableRowElement[];
}

/** The text of the Name column per rendered row. */
function names(): string[] {
  return dataRows().map((row) => row.querySelector('td.sf-data-table__first')!.textContent!.trim());
}

/** The header texts in display order. */
function headerTexts(): string[] {
  return within(screen.getByRole('grid'))
    .getAllByRole('columnheader')
    .map((th) => th.querySelector('.sf-data-table__header-text')?.textContent?.trim() ?? '');
}

function header(name: string): HTMLElement {
  return screen.getByRole('columnheader', { name: new RegExp(`^${name}`) });
}

afterEach(() => {
  config = DEFAULTS;
});

/** Gives the scroller a layout: a 320px viewport of 32px rows, a settable scrollTop and the given scroll height. */
function layoutScroller(scrollHeight = 0): { scroller: HTMLElement; scrollTo: (top: number) => void } {
  const scroller = document.querySelector<HTMLElement>('.sf-data-table__scroller')!;
  let scrollTop = 0;
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: 320 });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(scroller, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => (scrollTop = value),
  });
  scroller.style.setProperty('--sf-table-row-height', '32px');
  return {
    scroller,
    scrollTo: (top: number) => {
      scrollTop = top;
      fireEvent.scroll(scroller);
    },
  };
}

describe('SfDataTableComponent', () => {
  describe('rendering', () => {
    it('is a labelled grid with a header row, accessor text and cell templates', async () => {
      await setup();

      const grid = screen.getByRole('grid', { name: 'Items' });
      expect(grid).toHaveAttribute('aria-rowcount', '6');
      expect(headerTexts()).toEqual(['Name', 'Status', 'Size']);
      expect(names()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);
      expect(dataRows().map((r) => r.getAttribute('aria-rowindex'))).toEqual(['2', '3', '4', '5', '6']);
      // The status column renders its template with the row and its index.
      expect(dataRows()[1].querySelector('.status-cell')).toHaveTextContent('PUBLISHED #1');
      expect(dataRows()[0].cells[2]).toHaveAttribute('data-align', 'end');
    });
  });

  describe('sorting', () => {
    it('cycles a header through ascending, descending and unsorted, with aria-sort', async () => {
      await setup();
      const button = screen.getByRole('button', { name: 'Name' });

      fireEvent.click(button);
      expect(header('Name')).toHaveAttribute('aria-sort', 'ascending');
      expect(names()).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);

      fireEvent.click(button);
      expect(header('Name')).toHaveAttribute('aria-sort', 'descending');
      expect(names()).toEqual(['Gamma', 'Epsilon', 'Delta', 'Beta', 'Alpha']);

      fireEvent.click(button);
      expect(header('Name')).not.toHaveAttribute('aria-sort');
      expect(names()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);
    });

    it('adds sort keys with Shift (click or Enter), numbers them and puts aria-sort on the primary only', async () => {
      await setup();

      fireEvent.click(screen.getByRole('button', { name: 'Status' }));
      fireEvent.keyDown(screen.getByRole('button', { name: 'Size' }), { key: 'Enter', shiftKey: true });

      expect(names()).toEqual(['Epsilon', 'Gamma', 'Alpha', 'Beta', 'Delta']);
      expect(header('Status')).toHaveAttribute('aria-sort', 'ascending');
      expect(header('Size')).not.toHaveAttribute('aria-sort');
      expect(header('Status').querySelector('.sf-data-table__sort-position')).toHaveTextContent('1');
      expect(header('Size').querySelector('.sf-data-table__sort-position')).toHaveTextContent('2');
      expect(screen.getByRole('button', { name: 'Size sorted ascending' })).toBeInTheDocument();

      // Shift+click cycles the secondary key; a plain click makes a column the only key again.
      fireEvent.click(screen.getByRole('button', { name: 'Size sorted ascending' }), { shiftKey: true });
      expect(names()).toEqual(['Alpha', 'Gamma', 'Epsilon', 'Delta', 'Beta']);
      fireEvent.click(screen.getByRole('button', { name: 'Size sorted descending' }));
      expect(header('Size')).toHaveAttribute('aria-sort', 'ascending');
      expect(header('Status')).not.toHaveAttribute('aria-sort');
      expect(names()).toEqual(['Epsilon', 'Beta', 'Gamma', 'Delta', 'Alpha']);
    });

    it('leaves the order to the host in server mode and emits the sort', async () => {
      const { host } = await setup({ mode: 'server', total: 5 });

      fireEvent.click(screen.getByRole('button', { name: 'Size' }));

      expect(host.sorts).toEqual([[{ id: 'size', direction: 'asc' }]]);
      expect(host.queries.at(-1)).toMatchObject({ sort: [{ id: 'size', direction: 'asc' }], page: 0 });
      expect(names()).toEqual(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon']);
    });
  });

  describe('selection', () => {
    it('selects rows by checkbox, the page by the header checkbox (mixed when partial), and clears', async () => {
      const { host } = await setup({ selectable: true });
      const pageBox = screen.getByRole('checkbox', { name: 'Select all on this page' }) as HTMLInputElement;
      expect(screen.getByRole('grid')).toHaveAttribute('aria-multiselectable', 'true');

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
      expect(host.selections.at(-1)).toMatchObject({ keys: ['a'], count: 1, allMatching: false });
      expect(host.selections.at(-1)!.rows.map((r) => r.id)).toEqual(['a']);
      expect(dataRows()[0]).toHaveAttribute('aria-selected', 'true');
      expect(pageBox.indeterminate).toBe(true);
      const bar = screen.getByRole('group', { name: 'Bulk actions' });
      expect(bar).toHaveTextContent('1 selected');

      fireEvent.click(pageBox);
      expect(host.selections.at(-1)!.count).toBe(5);
      expect(pageBox).toBeChecked();
      expect(pageBox.indeterminate).toBe(false);
      expect(screen.getByRole('group', { name: 'Bulk actions' })).toHaveTextContent('5 selected');

      fireEvent.click(within(screen.getByRole('group', { name: 'Bulk actions' })).getByRole('button', { name: 'Clear selection' }));
      expect(host.selections.at(-1)!.count).toBe(0);
      expect(screen.queryByRole('group', { name: 'Bulk actions' })).toBeNull();
      expect(pageBox).not.toBeChecked();
    });

    it('selects rows by key from the host (selectKeys)', async () => {
      const { host, fixture } = await setup({ selectable: true });
      const table = fixture.debugElement.query((el) => el.name === 'sf-data-table').componentInstance as SfDataTableComponent<unknown>;

      table.selectKeys(['b', 'd']);
      fixture.detectChanges();
      expect(host.selections.at(-1)).toMatchObject({ keys: ['b', 'd'], count: 2 });
      expect(screen.getByRole('group', { name: 'Bulk actions' })).toHaveTextContent('2 selected');
    });

    it('selectKeys emits nothing when the keys are already the selection', async () => {
      const { host, fixture } = await setup({ selectable: true });
      const table = fixture.debugElement.query((el) => el.name === 'sf-data-table').componentInstance as SfDataTableComponent<unknown>;

      table.selectKeys(['b', 'd']);
      const emitted = host.selections.length;
      table.selectKeys(['d', 'b', 'd']);
      expect(host.selections).toHaveLength(emitted);
      // Keys of rows not on the page (server paging) are kept.
      table.selectKeys(['b', 'zz']);
      expect(host.selections).toHaveLength(emitted + 1);
      expect(host.selections.at(-1)).toMatchObject({ keys: ['b', 'zz'] });
    });

    it('selectKeys does nothing on a table that is not selectable', async () => {
      const { host, fixture } = await setup();
      const table = fixture.debugElement.query((el) => el.name === 'sf-data-table').componentInstance as SfDataTableComponent<unknown>;

      table.selectKeys(['b']);
      fixture.detectChanges();
      expect(host.selections).toEqual([]);
      expect(table.selection().keys).toEqual([]);
    });

    it('offers "select all N matching" after a full page (client: every matching row)', async () => {
      const { host } = await setup({ selectable: true, paging: 'pager', pageSize: 2 });

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
      expect(screen.getByRole('group', { name: 'Bulk actions' })).toHaveTextContent('2 selected');

      fireEvent.click(screen.getByRole('button', { name: 'Select all 5 matching' }));
      expect(host.selections.at(-1)).toMatchObject({ count: 5, allMatching: false });
      expect(host.selections.at(-1)!.keys).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(screen.queryByRole('button', { name: /matching/ })).toBeNull();
    });

    it('turns the selection into "all matching" with the host count in server mode', async () => {
      const { host } = await setup({ selectable: true, mode: 'server', total: 40, paging: 'pager', pageSize: 5 });

      fireEvent.click(screen.getByRole('checkbox', { name: 'Select all on this page' }));
      fireEvent.click(screen.getByRole('button', { name: 'Select all 40 matching' }));

      expect(host.selections.at(-1)).toMatchObject({ allMatching: true, count: 40 });
      expect(screen.getByRole('group', { name: 'Bulk actions' })).toHaveTextContent('40 selected');

      // Deselecting one row leaves "all matching" for the loaded rows minus that one.
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Beta' }));
      expect(host.selections.at(-1)).toMatchObject({ allMatching: false, count: 4 });
    });

    it('toggles with Space and extends a range with Shift+arrows and Shift+click', async () => {
      const { host } = await setup({ selectable: true });
      const rows = dataRows();
      rows[0].focus();

      fireEvent.keyDown(rows[0], { key: ' ' });
      expect(host.selections.at(-1)!.keys).toEqual(['a']);

      fireEvent.keyDown(rows[0], { key: 'ArrowDown', shiftKey: true });
      fireEvent.keyDown(dataRows()[1], { key: 'ArrowDown', shiftKey: true });
      expect(host.selections.at(-1)!.keys.sort()).toEqual(['a', 'b', 'c']);
      expect(document.activeElement).toBe(dataRows()[2]);

      // Back up shrinks the range to the anchor again.
      fireEvent.keyDown(dataRows()[2], { key: 'ArrowUp', shiftKey: true });
      expect(host.selections.at(-1)!.keys.sort()).toEqual(['a', 'b']);

      fireEvent.click(dataRows()[4], { shiftKey: true });
      expect(host.selections.at(-1)!.keys.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(host.opened).toEqual([]);
    });

    it('anchors a first Shift+click on the row that was active before, not on the clicked one', async () => {
      const { host } = await setup({ selectable: true });

      // Pointer focus makes the clicked row active before the click arrives.
      dataRows()[3].focus();
      fireEvent.click(dataRows()[3], { shiftKey: true });
      expect(host.selections.at(-1)!.keys.sort()).toEqual(['a', 'b', 'c', 'd']);
      expect(host.opened).toEqual([]);
    });

    it('anchors on the active row again after a sort reset the anchor', async () => {
      const { host } = await setup({ selectable: true });
      dataRows()[0].focus();
      fireEvent.keyDown(dataRows()[0], { key: 'ArrowDown' });
      fireEvent.keyDown(dataRows()[1], { key: 'ArrowDown' });

      // Size descending: Alpha 30, Gamma 20, Delta 20, Beta 10, Epsilon 5; the active row is the first again.
      fireEvent.click(screen.getByRole('button', { name: 'Size' }));
      fireEvent.click(screen.getByRole('button', { name: 'Size' }));
      dataRows()[2].focus();
      fireEvent.click(dataRows()[2], { shiftKey: true });
      expect(host.selections.at(-1)!.keys.sort()).toEqual(['a', 'c', 'd']);

      // Shift+arrow without an anchor extends from the active row too.
      const bar = screen.getByRole('group', { name: 'Bulk actions' });
      fireEvent.click(within(bar).getByRole('button', { name: 'Clear selection' }));
      fireEvent.click(screen.getByRole('button', { name: 'Size' }));
      dataRows()[0].focus();
      fireEvent.keyDown(dataRows()[0], { key: 'ArrowDown', shiftKey: true });
      expect(host.selections.at(-1)!.keys.sort()).toEqual(['a', 'b']);
    });

    it('runs bulk actions from the input and shows the projected ones', async () => {
      const { host } = await setup({ selectable: true });
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Gamma' }));
      const bar = screen.getByRole('group', { name: 'Bulk actions' });

      fireEvent.click(within(bar).getByRole('button', { name: 'Archive' }));
      expect(host.bulk).toHaveLength(1);
      expect(host.bulk[0].action.id).toBe('archive');
      expect(host.bulk[0].selection.keys).toEqual(['c']);

      fireEvent.click(within(bar).getByRole('button', { name: 'Delete' }));
      expect(host.deleted).toBe(true);
    });
  });

  describe('context menus', () => {
    it('opens the row menu on a right click, for the selection when the row is part of a selection of several', async () => {
      const { host } = await setup({ selectable: true });
      const menu = TestBed.inject(ContextMenuService);

      fireEvent.contextMenu(dataRows()[0]);
      expect(menu.state()?.items.map((i) => i.label)).toEqual(['Open 1']);
      expect(host.menuRows.at(-1)).toEqual([ITEMS[0]]);

      menu.close();
      fireEvent.click(within(dataRows()[0]).getByRole('checkbox'));
      fireEvent.click(within(dataRows()[1]).getByRole('checkbox'));
      fireEvent.contextMenu(dataRows()[1]);
      expect(host.menuRows.at(-1)).toEqual([ITEMS[0], ITEMS[1]]);
    });

    it('clears the selection on a left click on empty space, but not on a row', async () => {
      const { container, host } = await setup({ selectable: true });
      fireEvent.click(within(dataRows()[0]).getByRole('checkbox'));
      expect(host.selections.at(-1)?.count).toBe(1);

      fireEvent.click(dataRows()[1]);
      expect(host.selections.at(-1)?.count).toBe(1);

      fireEvent.click(container.querySelector<HTMLElement>('.sf-data-table__scroller')!);
      expect(host.selections.at(-1)?.count).toBe(0);
    });

    it('opens the empty-space menu below the rows, but not on the header', async () => {
      const { container } = await setup();
      const menu = TestBed.inject(ContextMenuService);

      fireEvent.contextMenu(container.querySelector<HTMLElement>('.sf-data-table__scroller')!);
      expect(menu.state()?.items.map((i) => i.label)).toEqual(['New item']);

      menu.close();
      fireEvent.contextMenu(screen.getByRole('columnheader', { name: /Name/ }));
      expect(menu.state()).toBeNull();
    });
  });

  describe('row keyboard', () => {
    it('moves the single tab stop with arrows, Home and End, and opens with Enter or a click', async () => {
      const { host } = await setup();
      const tabStops = () => dataRows().filter((r) => r.tabIndex === 0);
      expect(tabStops()).toEqual([dataRows()[0]]);

      dataRows()[0].focus();
      fireEvent.keyDown(dataRows()[0], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(dataRows()[1]);
      expect(tabStops()).toEqual([dataRows()[1]]);

      fireEvent.keyDown(dataRows()[1], { key: 'End' });
      expect(document.activeElement).toBe(dataRows()[4]);
      fireEvent.keyDown(dataRows()[4], { key: 'ArrowDown' });
      expect(document.activeElement).toBe(dataRows()[4]);

      fireEvent.keyDown(dataRows()[4], { key: 'Home' });
      expect(document.activeElement).toBe(dataRows()[0]);
      fireEvent.keyDown(dataRows()[0], { key: 'ArrowUp' });
      expect(document.activeElement).toBe(dataRows()[0]);

      fireEvent.keyDown(dataRows()[0], { key: 'Enter' });
      expect(host.opened.map((r) => r.id)).toEqual(['a']);
      fireEvent.click(dataRows()[3]);
      expect(host.opened.map((r) => r.id)).toEqual(['a', 'd']);
    });

    it('takes the row checkboxes out of the tab order and ignores Space in them', async () => {
      const { host } = await setup({ selectable: true });
      expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toHaveAttribute('tabindex', '-1');

      fireEvent.keyDown(screen.getByRole('checkbox', { name: 'Select Alpha' }), { key: 'Enter' });
      expect(host.opened).toEqual([]);
    });
  });

  describe('columns', () => {
    it('resizes a column with the keyboard on its separator', async () => {
      await setup();
      const handle = screen.getByRole('separator', { name: 'Resize column Name' });
      expect(handle).toHaveAttribute('tabindex', '0');
      expect(handle).toHaveAttribute('aria-valuenow', '200');
      expect(handle).toHaveAttribute('aria-valuemin', '48');

      fireEvent.keyDown(handle, { key: 'ArrowRight' });
      expect(handle).toHaveAttribute('aria-valuenow', '216');
      fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
      expect(handle).toHaveAttribute('aria-valuenow', '152');
      expect(document.querySelector('col:first-child')).toHaveStyle({ width: '152px' });
      fireEvent.keyDown(handle, { key: 'Home' });
      expect(handle).toHaveAttribute('aria-valuenow', '48');

      // A column without a width starts from a fallback when nothing can be measured.
      const status = screen.getByRole('separator', { name: 'Resize column Status' });
      expect(status).not.toHaveAttribute('aria-valuenow');
      fireEvent.keyDown(status, { key: 'ArrowRight' });
      expect(status).toHaveAttribute('aria-valuenow', '176');
    });

    it('resizes by dragging the handle', async () => {
      await setup();
      const handle = screen.getByRole('separator', { name: 'Resize column Name' });

      // jsdom has no PointerEvent: mouse events of the pointer types carry what the handle reads.
      const pointer = (type: string, clientX: number) =>
        fireEvent(handle, new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }));

      pointer('pointerdown', 100);
      pointer('pointermove', 140);
      expect(handle).toHaveAttribute('aria-valuenow', '240');
      pointer('pointermove', 400 - 600);
      expect(handle).toHaveAttribute('aria-valuenow', '48');
      pointer('pointermove', 130);
      pointer('pointerup', 130);
      expect(handle).toHaveAttribute('aria-valuenow', '230');
      // Moves after the drag ended change nothing.
      pointer('pointermove', 300);
      expect(handle).toHaveAttribute('aria-valuenow', '230');
    });

    describe('with preferences', () => {
      const providers = [provideHttpClient(), provideHttpClientTesting()];

      it('hides and reorders columns through the chooser and stores the layout', async () => {
        const { fixture } = await setup({ tableId: 'items' }, providers);
        const prefs = TestBed.inject(PreferencesService);

        fireEvent.click(screen.getByRole('button', { name: 'Columns' }));
        const chooser = screen.getByRole('dialog', { name: 'Columns' });

        fireEvent.click(within(chooser).getByRole('checkbox', { name: 'Show Status' }));
        fixture.detectChanges();
        expect(screen.queryByRole('columnheader', { name: /^Status/ })).toBeNull();
        expect(prefs.tableColumns('items')).toMatchObject({ hidden: ['status'] });

        const moveLeft = within(chooser).getByRole('button', { name: 'Move Size left' });
        fireEvent.click(moveLeft);
        fixture.detectChanges();
        expect(prefs.tableColumns('items').order).toEqual(['name', 'size', 'status']);
        expect(headerTexts()).toEqual(['Name', 'Size']);
        // Focus stays on the moved column's button.
        expect(document.activeElement).toBe(within(chooser).getByRole('button', { name: 'Move Size left' }));

        // The last visible column can't be hidden; Name is the only other one left.
        fireEvent.click(within(chooser).getByRole('checkbox', { name: 'Show Size' }));
        fixture.detectChanges();
        expect(within(chooser).getByRole('checkbox', { name: 'Show Name' })).toBeDisabled();
        prefs.reset();
      });

      it('applies a stored layout', async () => {
        const { fixture } = await setup({ tableId: 'items' }, providers);
        const prefs = TestBed.inject(PreferencesService);
        expect(headerTexts()).toEqual(['Name', 'Status', 'Size']);

        // As when the preferences document arrives after the first render.
        prefs.setTableColumns('items', { order: ['size', 'name', 'status'], hidden: ['status'], widths: { size: 120 } });
        fixture.detectChanges();

        expect(headerTexts()).toEqual(['Size', 'Name']);
        expect(screen.getByRole('separator', { name: 'Resize column Size' })).toHaveAttribute('aria-valuenow', '120');
        // The first column in display order is the sticky one.
        expect(header('Size')).toHaveClass('sf-data-table__first');
        prefs.reset();
      });
    });
  });

  describe('filter bar', () => {
    it('searches the searchable columns and offers to clear', async () => {
      await setup();

      fireEvent.input(screen.getByRole('searchbox', { name: 'Search…' }), { target: { value: 'ta' } });
      expect(names()).toEqual(['Beta', 'Delta']);
      expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '3');

      fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
      expect(names()).toHaveLength(5);
      expect(screen.getByRole('searchbox', { name: 'Search…' })).toHaveValue('');
    });

    it('filters from the menu and shows each picked value as a removable chip', async () => {
      await setup();

      fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Status' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Published' }));

      expect(names()).toEqual(['Beta', 'Delta']);
      fireEvent.click(screen.getByRole('button', { name: 'Remove Status: Published' }));
      expect(names()).toHaveLength(5);
      expect(screen.queryByRole('button', { name: /Remove Status/ })).toBeNull();
    });
  });

  describe('URL sync', () => {
    async function harnessAt(url: string, overrides: Partial<Config> = {}) {
      config = { ...DEFAULTS, urlSync: '', ...overrides };
      TestBed.configureTestingModule({ providers: [provideRouter([{ path: 'items', component: Host }])] });
      const harness = await RouterTestingHarness.create();
      const host = await harness.navigateByUrl(url, Host);
      harness.detectChanges();
      return { harness, host, router: TestBed.inject(Router) };
    }

    it('restores search, filters and sort from the query params', async () => {
      const { host } = await harnessAt('/items?q=a&status=draft&sort=-size');

      expect(screen.getByRole('searchbox', { name: 'Search…' })).toHaveValue('a');
      expect(names()).toEqual(['Alpha', 'Gamma', 'Epsilon']);
      expect(header('Size')).toHaveAttribute('aria-sort', 'descending');
      expect(screen.getByRole('button', { name: 'Remove Status: Draft' })).toBeInTheDocument();
      await Promise.resolve();
      expect(host.queries[0]).toEqual({ search: 'a', filters: { status: ['draft'] }, sort: [{ id: 'size', direction: 'desc' }], page: 0 });
    });

    it('writes changes to the URL, merged with other params, and follows navigation', async () => {
      const { harness, router } = await harnessAt('/items?tab=all', { paging: 'pager', pageSize: 2 });

      fireEvent.click(screen.getByRole('button', { name: 'Name' }));
      fireEvent.click(screen.getByRole('button', { name: 'Name' }));
      await harness.fixture.whenStable();
      expect(router.url).toBe('/items?tab=all&sort=-name');

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      await harness.fixture.whenStable();
      expect(router.url).toBe('/items?tab=all&sort=-name&page=2');

      fireEvent.input(screen.getByRole('searchbox', { name: 'Search…' }), { target: { value: 'e' } });
      harness.detectChanges();
      await harness.fixture.whenStable();
      expect(router.url).toBe('/items?tab=all&sort=-name&q=e');

      await harness.navigateByUrl('/items?tab=all&sort=size');
      harness.detectChanges();
      expect(screen.getByRole('searchbox', { name: 'Search…' })).toHaveValue('');
      expect(header('Size')).toHaveAttribute('aria-sort', 'ascending');
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    });

    it('namespaces the params with a prefix', async () => {
      const { harness, router } = await harnessAt('/items?pages.q=gam', { urlSync: 'pages' });
      expect(names()).toEqual(['Gamma']);

      fireEvent.click(screen.getByRole('button', { name: 'Size' }));
      await harness.fixture.whenStable();
      expect(router.url).toBe('/items?pages.q=gam&pages.sort=size');
    });
  });

  describe('paging', () => {
    it('pages client rows with a pager and places them with aria-rowindex', async () => {
      const { host } = await setup({ paging: 'pager', pageSize: 2 });
      expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
      expect(names()).toEqual(['Alpha', 'Beta']);

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
      expect(names()).toEqual(['Gamma', 'Delta']);
      expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '6');
      expect(dataRows().map((r) => r.getAttribute('aria-rowindex'))).toEqual(['4', '5']);
      expect(host.pages).toEqual([1]);
    });

    it('asks the host for the next page in server mode', async () => {
      const { host } = await setup({ mode: 'server', total: 40, paging: 'pager', pageSize: 5 });
      expect(screen.getByText('Page 1 of 8')).toBeInTheDocument();
      expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '41');

      fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
      expect(host.pages).toEqual([1]);
      expect(host.queries.at(-1)!.page).toBe(1);
      expect(dataRows()[0]).toHaveAttribute('aria-rowindex', '7');
    });

    it('shows more client rows with "Load more"', async () => {
      await setup({ paging: 'infinite', pageSize: 2 });
      expect(names()).toHaveLength(2);

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      expect(names()).toHaveLength(4);
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      expect(names()).toHaveLength(5);
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });

    it('asks for more once per batch when scrolled to the end, and again after a batch failed', async () => {
      const { host, fixture } = await setup({ mode: 'server', total: 10, paging: 'infinite' });
      const { scrollTo } = layoutScroller(500);

      scrollTo(200);
      scrollTo(210);
      expect(host.loadMores).toBe(1);

      // The batch fails: loading ends without new rows, so reaching the end asks again.
      host.loading.set(true);
      fixture.detectChanges();
      scrollTo(200);
      expect(host.loadMores).toBe(1);
      host.loading.set(false);
      fixture.detectChanges();
      scrollTo(205);
      expect(host.loadMores).toBe(2);

      // An error ends the batch too.
      host.error.set('Network down');
      fixture.detectChanges();
      scrollTo(200);
      expect(host.loadMores).toBe(3);
    });

    it('lets the "Load more" button ask again even when the batch brought nothing', async () => {
      const { host, fixture } = await setup({ mode: 'server', total: 10, paging: 'infinite' });

      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      expect(host.loadMores).toBe(2);

      host.loading.set(true);
      fixture.detectChanges();
      fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
      expect(host.loadMores).toBe(2);
      host.loading.set(false);

      host.rows.set([...ITEMS, ...ITEMS.map((i) => ({ ...i, id: `${i.id}2` }))]);
      fixture.detectChanges();
      expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
    });
  });

  describe('states', () => {
    it('shows the empty state, with "Clear filters" when filtered', async () => {
      const { host, fixture } = await setup({ rows: [] });
      expect(screen.getByRole('heading', { name: 'No results' })).toBeInTheDocument();
      expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '1');

      host.rows.set(ITEMS);
      fixture.detectChanges();
      fireEvent.input(screen.getByRole('searchbox', { name: 'Search…' }), { target: { value: 'zzz' } });
      expect(screen.getByRole('heading', { name: 'No results' })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(2);
    });

    it('shows a skeleton while the first rows load, and aria-busy while reloading', async () => {
      const { host, fixture } = await setup({ rows: [], loading: true });
      expect(screen.queryByRole('grid')).toBeNull();
      expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');

      host.rows.set(ITEMS);
      fixture.detectChanges();
      expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true');

      host.loading.set(false);
      fixture.detectChanges();
      expect(screen.getByRole('grid')).not.toHaveAttribute('aria-busy');
    });

    it('shows an error with Retry', async () => {
      const { host } = await setup({ rows: [], error: true });
      expect(screen.getByText('Could not load the list.')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'No results' })).toBeNull();

      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(host.retries).toBe(1);
    });
  });

  describe('virtual scrolling', () => {
    const many: Item[] = Array.from({ length: 1000 }, (_, i) => ({
      id: `r${i}`,
      name: `Row ${i}`,
      status: i % 2 ? 'draft' : 'published',
      size: i,
    }));

    it('renders only a window of 1,000 rows once the viewport has a height, and keeps the active row rendered', async () => {
      const { fixture } = await setup({ rows: many });
      const { scroller } = layoutScroller();
      fireEvent.scroll(scroller);
      fixture.detectChanges();

      expect(dataRows().length).toBeLessThan(40);
      expect(names()[0]).toBe('Row 0');
      const after = document.querySelectorAll<HTMLElement>('.sf-data-table__spacer td');
      expect(after[after.length - 1].style.height).toBe(`${(1000 - dataRows().length) * 32}px`);
      expect(dataRows().at(-1)).toHaveAttribute('aria-rowindex', String(dataRows().length + 1));

      dataRows()[0].focus();
      fireEvent.keyDown(dataRows()[0], { key: 'End' });
      expect(document.activeElement).toHaveAttribute('data-row-index', '999');
      expect(document.activeElement).toHaveAttribute('aria-rowindex', '1001');
      expect(dataRows().length).toBeLessThan(40);
      expect(scroller.scrollTop).toBeGreaterThan(0);
    });

    it('keeps the keyboard focus when the focused row is scrolled out of the window, and gives it back', async () => {
      const { fixture, host } = await setup({ rows: many, selectable: true });
      const { scroller, scrollTo } = layoutScroller();
      fireEvent.scroll(scroller);
      fixture.detectChanges();
      dataRows()[0].focus();
      fireEvent.keyDown(dataRows()[0], { key: 'ArrowDown' });
      expect(document.activeElement).toHaveAttribute('data-row-index', '1');

      // A wheel scroll far away: row 1 leaves the DOM, the scroller holds the focus.
      scrollTo(500 * 32);
      fixture.detectChanges();
      expect(document.querySelector('tr[data-row-index="1"]')).toBeNull();
      expect(document.activeElement).toBe(scroller);
      expect(scroller).toHaveAttribute('tabindex', '-1');

      // Keys keep acting on the active row from there.
      fireEvent.keyDown(scroller, { key: ' ' });
      expect(host.selections.at(-1)!.keys).toEqual(['r1']);
      fireEvent.keyDown(scroller, { key: 'Enter' });
      expect(host.opened.map((r) => r.id)).toEqual(['r1']);

      // Scrolling back renders the active row again and focuses it.
      scrollTo(0);
      fixture.detectChanges();
      expect(document.activeElement).toHaveAttribute('data-row-index', '1');

      // An arrow key while parked moves on from the active row and brings it into view.
      scrollTo(500 * 32);
      fixture.detectChanges();
      fireEvent.keyDown(scroller, { key: 'ArrowDown' });
      expect(document.activeElement).toHaveAttribute('data-row-index', '2');
      expect(scroller.scrollTop).toBeLessThan(10 * 32);
    });
  });
});
