import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { fireEvent, render, screen, waitFor } from '@testing-library/angular';
import { of } from 'rxjs';
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
    const early = { uuid: 'page-early', uid: 'early', type: 'PAGE', displayName: 'Early page', folderPath: '/' };
    const late = { uuid: 'page-late', uid: 'late', type: 'PAGE', displayName: 'Late page', folderPath: '/' };
    /** Revision 5 created `late` and a folder; revision 4 only touched `early`. */
    const revisionsSince3 = [
      { revisionId: 5, summary: { assets: [{ uuid: 'page-late', type: 'PAGE', action: 'CREATE' }, { uuid: 'folder-new', type: 'FOLDER', action: 'CREATE' }] } },
      { revisionId: 4, summary: { assets: [{ uuid: 'page-early', type: 'PAGE', action: 'UPDATE' }] } },
    ];

    it('leaves out the pages and folders created after the viewed revision', async () => {
      const listRevisions = vi.fn().mockReturnValue(of(revisionsSince3));
      const api = apiStub({ listPages: vi.fn().mockReturnValue(of([early, late])), listRevisions });
      const store = projectStoreStub();
      const root = {
        uuid: 'root',
        path: '/',
        displayName: 'All Pages',
        children: [
          { uuid: 'folder-old', path: '/old/', displayName: 'Old folder', children: [] },
          { uuid: 'folder-new', path: '/new/', displayName: 'New folder', children: [] },
        ],
      };
      Object.assign(store, {
        pageFolderTree: signal([root] as never),
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
      expect(screen.getByText('New folder')).toBeTruthy();

      const timeTravel = TestBed.inject(TimeTravelStore);
      timeTravel.enter(3);

      await waitFor(() => expect(screen.queryByText('Late page')).toBeNull());
      expect(listRevisions).toHaveBeenCalledWith('proj', { since: 3, size: 2000 });
      expect(screen.getByText('Early page')).toBeTruthy();
      expect(screen.getByText('Old folder')).toBeTruthy();
      expect(screen.queryByText('New folder')).toBeNull();

      timeTravel.exit();
      await waitFor(() => expect(screen.getByText('Late page')).toBeTruthy());
    });
  });
});
