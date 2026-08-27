import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { NavFolderDetailComponent } from './nav-folder-detail.component';
import { NavigationService, type NavigationFolderView, type NavTreeView } from './navigation.service';

const folder: NavigationFolderView = {
  uuid: 'folder-uuid',
  uid: 'products',
  displayName: 'Products',
  revision: 3,
  folderPath: '/products/',
  startNode: undefined,
};

const children: NavTreeView[] = [
  {
    uuid: 'child-folder-uuid',
    type: 'FOLDER',
    uid: 'child_folder',
    displayName: 'Child folder',
    children: [],
  },
  {
    uuid: 'child-ref-uuid',
    type: 'PAGE_REFERENCE',
    uid: 'child_ref',
    displayName: 'Child reference',
    children: [],
  },
];

function makeNavStub(overrides: Partial<Record<keyof NavigationService, unknown>> = {}) {
  return {
    renameFolder: vi.fn().mockReturnValue(of({})),
    updateFolder: vi.fn().mockReturnValue(of({})),
    deleteFolder: vi.fn().mockReturnValue(of(undefined)),
    ...overrides,
  };
}

function makeApiStub(overrides: Partial<Record<keyof ApiClient, unknown>> = {}) {
  return {
    changeUid: vi.fn().mockReturnValue(of({ oldUid: 'products', newUid: 'new_uid', affectedTemplates: [] })),
    ...overrides,
  };
}

describe('NavFolderDetailComponent', () => {
  it('renders the folder name, path, and startNode options from its direct children', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavFolderDetailComponent, {
      componentInputs: { projectKey: 'proj', folder, children, isRoot: false },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    expect(screen.getByText('Products')).toBeTruthy();
    expect(screen.getByText('/products/')).toBeTruthy();
    expect(screen.getByText('Child folder')).toBeTruthy();
    expect(screen.getByText('Child reference')).toBeTruthy();
  });

  it('renames the folder via NavigationService.renameFolder with the If-Match etag', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavFolderDetailComponent, {
      componentInputs: { projectKey: 'proj', folder, children, isRoot: false },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    screen.getByLabelText('Rename folder').click();
    const input = screen.getByDisplayValue('Products') as HTMLInputElement;
    input.value = 'New name';
    input.dispatchEvent(new Event('input'));
    screen.getByText('Save').click();

    expect(nav.renameFolder).toHaveBeenCalledWith('proj', 'folder-uuid', 'New name', '"rev-3"');
  });

  it('changes the UID via ApiClient.changeUid and emits changed', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavFolderDetailComponent, {
      componentInputs: { projectKey: 'proj', folder, children, isRoot: false },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    screen.getByText('Change UID').click();
    const uidInput = screen.getByDisplayValue('products') as HTMLInputElement;
    uidInput.value = 'new_uid';
    uidInput.dispatchEvent(new Event('input'));
    screen.getByText('Save').click();

    expect(api.changeUid).toHaveBeenCalledWith('proj', 'folder-uuid', { uid: 'new_uid' });
  });

  it('sets startNode via NavigationService.updateFolder when a child is picked', async () => {
    const nav = makeNavStub();
    const api = makeApiStub();
    await render(NavFolderDetailComponent, {
      componentInputs: { projectKey: 'proj', folder, children, isRoot: false },
      providers: [
        { provide: NavigationService, useValue: nav },
        { provide: ApiClient, useValue: api },
      ],
    });

    const select = screen.getByLabelText('Entry page') as HTMLSelectElement;
    select.value = 'PAGE_REFERENCE:child-ref-uuid';
    select.dispatchEvent(new Event('change'));

    expect(nav.updateFolder).toHaveBeenCalledWith(
      'proj',
      'folder-uuid',
      { startNode: { kind: 'PAGE_REFERENCE', assetUuid: 'child-ref-uuid' } },
      '"rev-3"',
    );
  });

  it('disables rename and delete for the root folder', async () => {
    const nav = makeNavStub();
    await render(NavFolderDetailComponent, {
      componentInputs: { projectKey: 'proj', folder, children, isRoot: true },
      providers: [{ provide: NavigationService, useValue: nav }],
    });

    expect(screen.queryByLabelText('Rename folder')).toBeFalsy();
    expect(screen.queryByText('Delete folder')).toBeFalsy();
  });
});
