import { signal } from '@angular/core';
import { fireEvent, render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
import { ProjectAccessStore } from '../../core/project/project-access.store';
import { ProjectContextStore } from '../../core/project/project-context.store';
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
});
