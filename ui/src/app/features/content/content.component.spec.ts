import '@angular/compiler';
import { provideRouter, Router } from '@angular/router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/angular';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { AuthStore } from '../../core/auth/auth.store';
import { ContextMenuService } from '../../shared/services/context-menu.service';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { ContentComponent } from './content.component';
import { ContentService, type FolderView, type RecordSetSummaryView } from './content.service';

const FOLDERS: FolderView[] = [
  {
    uuid: 'root',
    uid: 'content_root',
    displayName: 'All Content',
    path: '/content_root/',
    protectedFolder: true,
    type: 'FOLDER',
    children: [
      {
        uuid: 'team',
        uid: 'team',
        displayName: 'Team',
        path: '/content_root/team/',
        type: 'FOLDER',
        children: [{ uuid: 'set-leads', uid: 'leads', displayName: 'Leads', type: 'RECORD_SET', recordCount: 3 }],
      },
      { uuid: 'set-products', uid: 'products', displayName: 'Products', type: 'RECORD_SET', recordCount: 0 },
    ],
  },
];

const SETS: RecordSetSummaryView[] = [
  {
    uuid: 'set-leads',
    uid: 'leads',
    displayName: 'Leads',
    dataset: { uuid: 'ds-team', displayName: 'Team' },
    folderUuid: 'team',
    folderPath: '/content_root/team/',
    recordCount: 3,
    queryValid: false,
  },
  {
    uuid: 'set-products',
    uid: 'products',
    displayName: 'Products',
    dataset: { uuid: 'ds-product', displayName: 'Product' },
    folderUuid: 'root',
    folderPath: '/content_root/',
    recordCount: 0,
    queryValid: true,
  },
];

function contentStub() {
  return {
    folders: vi.fn().mockReturnValue(of(FOLDERS)),
    listDatasets: vi.fn().mockReturnValue(
      of([
        { uuid: 'ds-team', displayName: 'Team' },
        { uuid: 'ds-product', displayName: 'Product' },
      ]),
    ),
    listRecordSets: vi.fn().mockReturnValue(of(SETS)),
    createRecordSet: vi.fn().mockReturnValue(of({ uuid: 'set-new' })),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    moveFolder: vi.fn().mockReturnValue(of({})),
    moveAsset: vi.fn().mockReturnValue(of({})),
    deleteRecordSet: vi.fn().mockReturnValue(of(undefined)),
  };
}

async function setup(content: ReturnType<typeof contentStub>, menu = new ContextMenuService(), role = 'EDITOR') {
  const view = await render(ContentComponent, {
    componentInputs: { projectKey: 'proj' },
    providers: [
      provideRouter([]),
      { provide: ContentService, useValue: content },
      { provide: ApiClient, useValue: { renameAsset: vi.fn() } },
      { provide: AuthStore, useValue: { roleFor: () => role } },
      { provide: TimeTravelStore, useValue: new TimeTravelStore() },
      { provide: ContextMenuService, useValue: menu },
    ],
  });
  const router = view.fixture.debugElement.injector.get(Router);
  const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  return { ...view, navigate };
}

function treeRow(name: string): HTMLElement {
  return screen.getAllByText(name).find((el) => el.closest('[role="treeitem"]'))!.closest('[role="treeitem"]') as HTMLElement;
}

describe('ContentComponent (record sets)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('shows record sets as tree leaves with their record count and an invalid-query warning', async () => {
    await setup(contentStub());

    await waitFor(() => expect(treeRow('Leads')).toBeTruthy());
    expect(treeRow('Leads').textContent).toContain('3 records');
    expect(treeRow('Leads').querySelector('.store-node__warning')).not.toBeNull();
    expect(treeRow('Products').querySelector('.store-node__warning')).toBeNull();
  });

  it('lists the sets, narrowed by the dataset chip', async () => {
    await setup(contentStub());
    await waitFor(() => expect(screen.getByRole('link', { name: /Products/ })).toBeTruthy());
    expect(screen.getByRole('link', { name: /Leads/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Team/ }));

    await waitFor(() => expect(screen.queryByRole('link', { name: /Products/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Leads/ })).toBeTruthy();
  });

  it('opens a set from the tree', async () => {
    const { navigate } = await setup(contentStub());
    await waitFor(() => expect(treeRow('Leads')).toBeTruthy());

    fireEvent.click(treeRow('Leads'));

    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content', 'sets', 'set-leads'], { queryParams: {} });
  });

  it('creates a record set in the right-clicked folder with the chosen dataset', async () => {
    const content = contentStub();
    const menu = new ContextMenuService();
    const open = vi.spyOn(menu, 'open');
    const { navigate } = await setup(content, menu);
    await waitFor(() => expect(treeRow('Team')).toBeTruthy());

    fireEvent.contextMenu(treeRow('Team'));
    const items = open.mock.calls[0][1];
    expect(items.map((item) => item.label)).toEqual(['Rename', 'New folder', 'New record set']);
    items.find((item) => item.label === 'New record set')!.action!();
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'New record set' })).toBeTruthy());

    fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'Staff' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    expect(content.createRecordSet).toHaveBeenCalledWith('proj', {
      folderUuid: 'team',
      datasetUuid: 'ds-team',
      uid: undefined,
      displayName: 'Staff',
    });
    expect(navigate).toHaveBeenCalledWith(['/p', 'proj', 'content', 'sets', 'set-new'], { queryParams: {} });
  });

  it("offers a set's menu: new record, move, history, usages, delete", async () => {
    const menu = new ContextMenuService();
    const open = vi.spyOn(menu, 'open');
    await setup(contentStub(), menu);
    await waitFor(() => expect(treeRow('Leads')).toBeTruthy());

    fireEvent.contextMenu(treeRow('Leads'));

    expect(open.mock.calls[0][1].map((item) => item.label)).toEqual([
      'Rename',
      'New record',
      'Move to…',
      'History',
      'Used by',
      'Delete…',
    ]);
  });

  it('moves a set only into folders', async () => {
    const content = contentStub();
    const menu = new ContextMenuService();
    const open = vi.spyOn(menu, 'open');
    await setup(content, menu);
    await waitFor(() => expect(treeRow('Products')).toBeTruthy());

    fireEvent.contextMenu(treeRow('Products'));
    open.mock.calls[0][1].find((item) => item.label === 'Move to…')!.action!();
    const dialog = await screen.findByRole('dialog', { name: /Move “Products” to…/ });

    const radios = within(dialog).getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((radio) => radio.closest('label')?.querySelector('.move__label')?.textContent)).toEqual([
      'All content',
      'Team',
    ]);
    expect(radios[0].disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /Team/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));

    expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-products', 'team');
  });

  it('deletes a set with its records after confirming the count', async () => {
    const content = contentStub();
    const menu = new ContextMenuService();
    const open = vi.spyOn(menu, 'open');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await setup(content, menu);
    await waitFor(() => expect(treeRow('Leads')).toBeTruthy());

    fireEvent.contextMenu(treeRow('Leads'));
    open.mock.calls[0][1].find((item) => item.label === 'Delete…')!.action!();

    expect(confirm.mock.calls[0][0]).toContain('and its 3 records');
    expect(content.deleteRecordSet).toHaveBeenCalledWith('proj', 'set-leads', true);
    await waitFor(() => expect(content.folders).toHaveBeenCalledTimes(2));
  });

  it('drags a set onto a folder through the asset move, a folder through the folder move', async () => {
    const content = contentStub();
    await setup(content);
    await waitFor(() => expect(treeRow('Team')).toBeTruthy());

    const drop = (source: string) =>
      fireEvent.drop(treeRow('Team'), { dataTransfer: { getData: () => source } as unknown as DataTransfer });
    drop('set-products');

    expect(content.moveAsset).toHaveBeenCalledWith('proj', 'set-products', 'team');
    expect(content.moveFolder).not.toHaveBeenCalled();
  });

  it('keeps every create control disabled for a viewer', async () => {
    await setup(contentStub(), new ContextMenuService(), 'VIEWER');
    await waitFor(() => expect(treeRow('Leads')).toBeTruthy());

    expect((screen.getAllByRole('button', { name: 'New record set' })[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'New folder' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
