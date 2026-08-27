import { signal } from '@angular/core';
import { render, screen } from '@testing-library/angular';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../../core/api/api.client';
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

    screen.getByText('New page').click();

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    nameInput.value = 'My Page';
    nameInput.dispatchEvent(new Event('input'));

    const select = screen.getByLabelText('Template') as HTMLSelectElement;
    select.value = 'tpl-1';
    select.dispatchEvent(new Event('change'));

    screen.getByText('Create').click();

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

    const nameInput = screen.getByLabelText('Name') as HTMLInputElement;
    nameInput.value = 'Assets';
    nameInput.dispatchEvent(new Event('input'));

    screen.getByText('Create').click();

    expect(api.createFolder).toHaveBeenCalledWith('proj', {
      displayName: 'Assets',
      parentFolderUuid: undefined,
      scope: 'PAGES',
    });
  });
});
