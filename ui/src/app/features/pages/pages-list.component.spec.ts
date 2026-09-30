import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
import { TimeTravelStore } from '../revisions/time-travel.store';
import { PagesListComponent } from './pages-list.component';

function projectStoreStub() {
  return {
    pageFolderTree: signal([]),
    pageTemplates: signal([{ uuid: 'tpl-1', displayName: 'Landing' }]),
    loadFor: vi.fn().mockReturnValue(of(undefined)),
  };
}

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    listPages: vi.fn().mockReturnValue(of([])),
    createPage: vi.fn().mockReturnValue(of({ uuid: 'page-1' })),
    createFolder: vi.fn().mockReturnValue(of({ uuid: 'folder-1' })),
    moveAsset: vi.fn().mockReturnValue(of({})),
    ...overrides,
  };
}

describe('PagesListComponent', () => {
  it('opens the create-page dialog and calls ApiClient.createPage on submit, then reloads the list', async () => {
    const api = apiStub();
    const store = projectStoreStub();
    await render(PagesListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ProjectContextStore, useValue: store },
      ],
    });

    screen.getByRole('button', { name: 'New page' }).click();

    // `findBy*`/`fireEvent` run change detection: the dialog only renders on the pass after the
    // click, and its submit button stays `[disabled]` until the form reads as valid.
    fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'My Page' } });
    fireEvent.change(screen.getByLabelText('Template'), { target: { value: 'tpl-1' } });

    screen.getByRole('button', { name: 'Create' }).click();

    expect(api.createPage).toHaveBeenCalledWith('proj', {
      displayName: 'My Page',
      templateUuid: 'tpl-1',
      folderUuid: undefined,
    });
    expect(api.listPages).toHaveBeenCalled();
  });

  it('opens the create-folder dialog scoped to PAGES and calls ApiClient.createFolder on submit', async () => {
    const api = apiStub();
    const store = projectStoreStub();
    await render(PagesListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: api },
        { provide: ProjectContextStore, useValue: store },
      ],
    });

    screen.getByTitle('New folder').click();

    fireEvent.input(await screen.findByLabelText('Name'), { target: { value: 'Assets' } });

    screen.getByRole('button', { name: 'Create' }).click();

    expect(api.createFolder).toHaveBeenCalledWith('proj', {
      displayName: 'Assets',
      parentFolderUuid: undefined,
      scope: 'PAGES',
    });
  });

  it('offers no page or folder creation in an archived project (M26)', async () => {
    await render(PagesListComponent, {
      componentInputs: { projectKey: 'proj' },
      providers: [
        { provide: ApiClient, useValue: apiStub() },
        { provide: ProjectContextStore, useValue: projectStoreStub() },
      ],
      configureTestBed: (tb) => tb.inject(ProjectAccessStore).enterProject('proj', true),
    });

    expect((screen.getByRole('button', { name: 'New page' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle('New folder') as HTMLButtonElement).disabled).toBe(true);
  });

  describe('time travel', () => {
    /** Present: `late` and the folder `new`. At revision 3: `early` and the folder `old`, both deleted since. */
    const early = { uuid: 'page-early', uid: 'early', type: 'PAGE', displayName: 'Early page', folderPath: '/' };
    const late = { uuid: 'page-late', uid: 'late', type: 'PAGE', displayName: 'Late page', folderPath: '/' };
    const tree = (...names: string[]) => [
      {
        uuid: 'root',
        path: '/',
        displayName: 'All Pages',
        children: names.map((name) => ({ uuid: `folder-${name}`, path: `/${name}/`, displayName: `${name} folder`, children: [] })),
      },
    ];

    it('reads the tree and the list at the viewed revision and shows what they return', async () => {
      const listPages = vi
        .fn()
        .mockImplementation((_key: string, opts: { revision?: number }) => of(opts.revision === 3 ? [early] : [late]));
      const listFolders = vi.fn().mockReturnValue(of(tree('old')));
      const api = apiStub({ listPages, listFolders });
      const store = projectStoreStub();
      Object.assign(store, {
        pageFolderTree: signal(tree('new') as never),
        // What the page rows read to highlight the open page.
        activePageUuid: signal(null),
        activeBodyName: signal(null),
        activeSectionInstanceId: signal(null),
        pageMutated: signal(null),
      });
      await render(PagesListComponent, {
        componentInputs: { projectKey: 'proj' },
        providers: [
          { provide: ApiClient, useValue: api },
          { provide: ProjectContextStore, useValue: store },
        ],
      });
      expect(await screen.findByText('Late page')).toBeTruthy();
      expect(screen.getByText('new folder')).toBeTruthy();
      expect(listFolders).not.toHaveBeenCalled();
      expect(listPages).toHaveBeenLastCalledWith('proj', { q: undefined, revision: undefined });

      const timeTravel = TestBed.inject(TimeTravelStore);
      timeTravel.enter(3);

      // Items deleted since are back, items created later are gone — as the server answered, not filtered here.
      expect(await screen.findByText('Early page')).toBeTruthy();
      await waitFor(() => expect(screen.queryByText('Late page')).toBeNull());
      expect(screen.getByText('old folder')).toBeTruthy();
      expect(screen.queryByText('new folder')).toBeNull();
      expect(listFolders).toHaveBeenCalledWith('proj', 'PAGES', 10, 3);
      expect(listPages).toHaveBeenLastCalledWith('proj', { q: undefined, revision: 3 });

      timeTravel.exit();
      expect(await screen.findByText('Late page')).toBeTruthy();
      await waitFor(() => expect(screen.getByText('new folder')).toBeTruthy());
      expect(screen.queryByText('Early page')).toBeNull();
      expect(screen.queryByText('old folder')).toBeNull();
    });

    it('shows no folders while the tree of the revision is still being read, never the present one', async () => {
      const pending = new Subject<never[]>();
      const api = apiStub({ listFolders: vi.fn().mockReturnValue(pending) });
      const store = projectStoreStub();
      Object.assign(store, {
        pageFolderTree: signal(tree('new') as never),
        activePageUuid: signal(null),
        activeBodyName: signal(null),
        activeSectionInstanceId: signal(null),
        pageMutated: signal(null),
      });
      await render(PagesListComponent, {
        componentInputs: { projectKey: 'proj' },
        providers: [
          { provide: ApiClient, useValue: api },
          { provide: ProjectContextStore, useValue: store },
        ],
      });
      expect(await screen.findByText('new folder')).toBeTruthy();

      TestBed.inject(TimeTravelStore).enter(3);

      await waitFor(() => expect(screen.queryByText('new folder')).toBeNull());
    });
  });
});
